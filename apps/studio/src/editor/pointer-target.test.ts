import { describe, expect, it } from "vitest";

import { pointInsideElement } from "./pointer-target.js";

const elementWithBounds = (bounds: Partial<DOMRect>) =>
  ({
    getBoundingClientRect: () =>
      ({ left: 10, right: 30, top: 20, bottom: 40, ...bounds }) as DOMRect,
  }) as Element;

describe("pointer targets", () => {
  it("accepts every point inside the target rectangle", () => {
    const element = elementWithBounds({});

    expect(pointInsideElement(element, 10, 20)).toBe(true);
    expect(pointInsideElement(element, 20, 30)).toBe(true);
    expect(pointInsideElement(element, 30, 40)).toBe(true);
  });

  it("rejects points and missing targets outside the rectangle", () => {
    const element = elementWithBounds({});

    expect(pointInsideElement(element, 31, 30)).toBe(false);
    expect(pointInsideElement(element, 20, 41)).toBe(false);
    expect(pointInsideElement(null, 20, 30)).toBe(false);
  });
});
