export const shouldSubmitProducerInstruction = ({
  key,
  shiftKey,
  isComposing,
}: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
}) => key === "Enter" && !shiftKey && !isComposing;
