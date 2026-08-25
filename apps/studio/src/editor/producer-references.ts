export type ProducerReferenceId = {
  type: "item" | "track" | "gap";
  id: string;
};

const referenceKey = (reference: ProducerReferenceId) =>
  `${reference.type}:${reference.id}`;

export const appendProducerReferences = (
  current: ProducerReferenceId[],
  incoming: ProducerReferenceId[],
) => {
  const existing = new Set(current.map(referenceKey));
  return [
    ...current,
    ...incoming.filter((reference) => !existing.has(referenceKey(reference))),
  ];
};

export const removeProducerReference = (
  current: ProducerReferenceId[],
  target: ProducerReferenceId,
) =>
  current.filter(
    (reference) => referenceKey(reference) !== referenceKey(target),
  );
