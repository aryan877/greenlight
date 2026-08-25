export type ProducerSceneReference = {
  sceneId: string;
  title: string;
};

export type ProducerDraftIntent =
  | {
      id: string;
      text: string;
      mode: "replace";
    }
  | ({ id: string; mode: "attach-scene" } & ProducerSceneReference);

export const attachProducerSceneReference = (
  current: ProducerSceneReference[],
  reference: ProducerSceneReference,
) =>
  current.some(({ sceneId }) => sceneId === reference.sceneId)
    ? current
    : [...current, reference];
