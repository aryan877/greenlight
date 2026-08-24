import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Artifact } from "@greenlight/contracts";

import type { ArtifactStore } from "../storage/artifacts.js";

type OpenMojiRecord = {
  annotation: string;
  group: string;
  hexcode: string;
  order: string;
  subgroups: string;
  tags: string;
};

export type OpenMojiMatch = Pick<
  OpenMojiRecord,
  "annotation" | "group" | "hexcode" | "tags"
>;

const tokens = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

export class OpenMojiToolkit {
  private catalog: OpenMojiRecord[] | null = null;

  constructor(
    private readonly root: string,
    private readonly artifacts: ArtifactStore,
  ) {}

  describe() {
    return {
      available: true,
      provider: "openmoji",
      license: "CC BY-SA 4.0",
      mode: "local_catalog",
    };
  }

  async search(query: string, limit: number): Promise<OpenMojiMatch[]> {
    const catalog = await this.loadCatalog();
    const queryTokens = tokens(query);
    return catalog
      .map((item) => {
        const annotation = item.annotation.toLowerCase();
        const haystack = new Set(tokens(`${item.annotation} ${item.tags}`));
        const score = queryTokens.reduce(
          (total, token) =>
            total +
            (annotation === token ? 8 : 0) +
            (annotation.includes(token) ? 4 : 0) +
            (haystack.has(token) ? 2 : 0),
          0,
        );
        return { item, score };
      })
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          Number(left.item.order) - Number(right.item.order),
      )
      .slice(0, limit)
      .map(({ item }) => ({
        annotation: item.annotation,
        group: item.group,
        hexcode: item.hexcode,
        tags: item.tags,
      }));
  }

  async attach(input: {
    projectId: string;
    sceneId: string;
    hexcode: string;
  }): Promise<Artifact> {
    const catalog = await this.loadCatalog();
    const hexcode = input.hexcode.toUpperCase();
    const item = catalog.find((candidate) => candidate.hexcode === hexcode);
    if (!item) throw new Error("openmoji_not_found");
    const bytes = await readFile(
      join(this.root, "color", "svg", `${hexcode}.svg`),
    );
    return this.artifacts.importBuffer({
      projectId: input.projectId,
      kind: "image",
      filename: `${hexcode}.svg`,
      bytes,
      provenance: {
        provider: "openmoji",
        scene_id: input.sceneId,
        hexcode,
        annotation: item.annotation,
        license: "CC BY-SA 4.0",
        source: "https://openmoji.org/",
      },
    });
  }

  private async loadCatalog(): Promise<OpenMojiRecord[]> {
    if (!this.catalog) {
      this.catalog = JSON.parse(
        await readFile(join(this.root, "data", "openmoji.json"), "utf8"),
      ) as OpenMojiRecord[];
    }
    return this.catalog;
  }
}
