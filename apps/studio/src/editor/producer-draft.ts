export type ProducerDraftIntent = {
  id: string;
  text: string;
  mode: "replace" | "append";
};

export const mergeProducerDraft = (
  current: string,
  draft: ProducerDraftIntent,
) => {
  if (draft.mode === "replace") return draft.text;
  const reference = draft.text.trim();
  if (!reference || current.includes(reference)) return current;
  return current.trim() ? `${current.trim()} ${reference} ` : `${reference} `;
};
