export const pointInsideElement = (
  element: Element | null,
  clientX: number,
  clientY: number,
) => {
  if (!element) return false;
  const bounds = element.getBoundingClientRect();
  return (
    clientX >= bounds.left &&
    clientX <= bounds.right &&
    clientY >= bounds.top &&
    clientY <= bounds.bottom
  );
};

export const pointInsideProducer = (clientX: number, clientY: number) =>
  pointInsideElement(
    document.querySelector('[data-testid="producer-composer"]'),
    clientX,
    clientY,
  );
