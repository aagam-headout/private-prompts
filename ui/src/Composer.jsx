import { useEffect, useRef, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// Deliberately plain: writing and queueing only. Rewriting a prompt lives in
// the Enhance tab, where the draft and the result can sit side by side.
export default function Composer({ project, projectName, onAdd, onEnhance }) {
  const [text, setText] = useState("");
  const box = useRef(null);

  // Grow with the content instead of making the user drag a resize corner.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(300, Math.max(76, el.scrollHeight))}px`;
  }, [text]);

  const canSubmit = Boolean(project) && Boolean(text.trim());

  async function submit() {
    if (!canSubmit) return;
    await onAdd(text);
    setText("");
  }

  return (
    <div className="bg-card focus-within:border-muted-foreground/40 rounded-xl border transition-colors focus-within:shadow-sm">
      <Textarea
        ref={box}
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
        className="min-h-[76px] resize-none border-0 bg-transparent px-4 py-3 font-mono text-[13px] shadow-none focus-visible:ring-0 dark:bg-transparent"
      />

      <div className="flex items-center gap-2 px-2 pb-2">
        {text.trim() && (
          <Button variant="ghost" size="sm" onClick={() => onEnhance(text)}>
            <Sparkles className="size-3.5" />
            Refine first
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1 sm:flex">
            <kbd className="text-muted-foreground bg-muted rounded border px-1.5 py-0.5 text-[10px]">
              ⌘
            </kbd>
            <kbd className="text-muted-foreground bg-muted rounded border px-1.5 py-0.5 text-[10px]">
              enter
            </kbd>
          </span>
          <Button size="sm" disabled={!canSubmit} onClick={submit}>
            <Plus className="size-3.5" />
            Queue
          </Button>
        </div>
      </div>
    </div>
  );
}
