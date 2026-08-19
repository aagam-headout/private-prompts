import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";

// Deliberately plain: writing and queueing only. Rewriting a prompt lives in
// the Enhance tab, where the draft and the result can sit side by side.
export default function Composer({ project, projectName, onAdd, onEnhance }) {
  const [text, setText] = useState("");

  const canSubmit = Boolean(project) && Boolean(text.trim());

  async function submit() {
    if (!canSubmit) return;
    await onAdd(text);
    setText("");
  }

  return (
    <div className="bg-card ring-border focus-within:ring-ring/60 rounded-xl ring-1 ring-inset transition-shadow focus-within:ring-2">
      <Textarea
        value={text}
        placeholder={
          project
            ? `Queue a prompt for ${projectName || "this project"}…`
            : "Open this page from the CLI to queue prompts"
        }
        disabled={!project}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Enter alone inserts a newline — prompts are usually multi-line.
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
        }}
        // field-sizing-content (from the base Textarea) grows the box with the
        // text; the max keeps a long draft from pushing the queue off screen.
        className="max-h-[18rem] min-h-[5.5rem] resize-none border-0 bg-transparent px-3.5 py-3 text-[13.5px] leading-relaxed shadow-none focus-visible:ring-0 disabled:bg-transparent dark:bg-transparent dark:disabled:bg-transparent"
      />

      <div className="flex items-center gap-2 border-t px-2 py-2">
        {text.trim() ? (
          <Button variant="ghost" size="sm" onClick={() => onEnhance(text)}>
            <Sparkles />
            Refine first
          </Button>
        ) : (
          <span className="text-muted-foreground pl-1.5 text-xs">
            {project ? "Agents pick these up in order" : "No project — start from the CLI"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <KbdGroup className="max-sm:hidden">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
          </KbdGroup>
          <Button size="sm" disabled={!canSubmit} onClick={submit}>
            <Plus />
            Queue
          </Button>
        </div>
      </div>
    </div>
  );
}
