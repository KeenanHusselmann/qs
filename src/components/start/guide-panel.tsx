"use client";

/**
 * The assistant, in the panel — the overview's side of the same affordance as the project advisor.
 *
 * It shares `advisor-state`, so the panel opens and closes as one thing across the platform: open it
 * on a project, navigate to the overview, and this one is already there. The conversation is held
 * here rather than inside `Guide` so the header's "New conversation" button can clear it.
 *
 * The inline card stays on `/start`, where the page *is* the explainer and a panel would hide it.
 */

import { AssistantPanel } from "@/components/shell/assistant-panel";
import { Guide, useGuideConversation } from "@/components/start/guide";

export function GuidePanel() {
  const conversation = useGuideConversation();

  return (
    <AssistantPanel
      label="Assistant"
      offer="Ask the assistant anything"
      region="guide-panel"
      subtitle="Construction and platform questions"
      expandable
      onReset={conversation.thread.length > 0 ? conversation.reset : undefined}
    >
      <Guide beside="panel" conversation={conversation} />
    </AssistantPanel>
  );
}
