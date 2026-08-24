import { contentPackageSchema } from "@greenlight/contracts";
import { Composition, Still } from "remotion";
import { z } from "zod";

import {
  FPS,
  GreenlightFilm,
  GreenlightThumbnail,
  getDurationInFrames,
} from "./GreenlightFilm";
import { renderSpec } from "./design";
import { fixturePackage } from "./fixture";

export const renderProjectSchema = z.object({
  content: contentPackageSchema,
  assetFiles: z.record(z.string(), z.string()),
});

export type RenderProject = z.infer<typeof renderProjectSchema>;

const defaultProps: RenderProject = {
  content: fixturePackage,
  assetFiles: {},
};

export const RemotionRoot = () => (
  <>
    <Composition
      id="GreenlightFilm"
      component={GreenlightFilm}
      durationInFrames={getDurationInFrames(fixturePackage)}
      fps={FPS}
      width={renderSpec.format.width}
      height={renderSpec.format.height}
      defaultProps={defaultProps}
      schema={renderProjectSchema}
      calculateMetadata={({ props }) => ({
        durationInFrames: getDurationInFrames(props.content),
      })}
    />
    <Still
      id="GreenlightThumbnail"
      component={GreenlightThumbnail}
      width={renderSpec.format.thumbnailWidth}
      height={renderSpec.format.thumbnailHeight}
      defaultProps={defaultProps}
      schema={renderProjectSchema}
    />
  </>
);
