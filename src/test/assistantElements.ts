import type { ReactNode } from "react";
import { AssistantCaption } from "../assistant/AssistantFeedback";
import { AssistantComposer, AssistantMicButton, AssistantTypingButton } from "../assistant/AssistantControls";
import { elements as collectElements } from "./hookHarness";

/** Expand the assistant's shared, hook-free controls to exercise real handlers. */
export function elements(node: ReactNode): ReturnType<typeof collectElements> {
  return collectElements(node).flatMap((element) => {
    let rendered: ReactNode;
    switch (element.type) {
      case AssistantCaption:
        rendered = AssistantCaption(element.props as unknown as Parameters<typeof AssistantCaption>[0]);
        break;
      case AssistantComposer:
        rendered = AssistantComposer(element.props as unknown as Parameters<typeof AssistantComposer>[0]);
        break;
      case AssistantMicButton:
        rendered = AssistantMicButton(element.props as unknown as Parameters<typeof AssistantMicButton>[0]);
        break;
      case AssistantTypingButton:
        rendered = AssistantTypingButton(element.props as unknown as Parameters<typeof AssistantTypingButton>[0]);
        break;
      default:
        return [element];
    }
    return [element, ...elements(rendered)];
  });
}
