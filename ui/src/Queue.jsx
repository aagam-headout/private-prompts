import { useState } from "react";
import { GripVertical } from "lucide-react";
import PromptItem from "./PromptItem.jsx";
import { cn } from "@/lib/utils";

function move(items, fromId, toId) {
  const from = items.findIndex((p) => p.id === fromId);
  const to = items.findIndex((p) => p.id === toId);
  if (from < 0 || to < 0 || from === to) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function sameOrder(a, b) {
  return a.length === b.length && a.every((p, i) => p.id === b[i].id);
}

export default function Queue({ prompts, canReorder, onReorder, onDraggingChange, itemProps }) {
  // While a drag is in flight the list is driven locally so the row follows the
  // cursor; `null` means "just show what the server gave us".
  const [order, setOrder] = useState(null);
  const [dragId, setDragId] = useState(null);
  // Only a mousedown on the handle arms dragging, so text inside a prompt stays
  // selectable everywhere else in the row.
  const [armed, setArmed] = useState(null);

  const list = order ?? prompts;

  function begin(id) {
    setDragId(id);
    setOrder(prompts);
    onDraggingChange(true);
  }

  function over(targetId) {
    if (dragId === null || dragId === targetId) return;
    setOrder((current) => move(current ?? prompts, dragId, targetId));
  }

  async function end() {
    const settled = order;
    setDragId(null);
    setArmed(null);
    onDraggingChange(false);
    if (settled && !sameOrder(settled, prompts)) {
      await onReorder(settled.map((p) => p.id));
    }
    setOrder(null);
  }

  // Keyboard equivalent of a drag: the handle is focusable and arrow keys shift
  // one position, committing immediately.
  async function nudge(id, delta) {
    const index = list.findIndex((p) => p.id === id);
    const target = list[index + delta];
    if (!target) return;
    const next = move(list, id, target.id);
    setOrder(next);
    await onReorder(next.map((p) => p.id));
    setOrder(null);
  }

  return (
    <div className="space-y-1">
      {list.map((prompt) => (
        <div
          key={prompt.id}
          className={cn("group/row flex items-center", dragId === prompt.id && "opacity-40")}
          draggable={canReorder && armed === prompt.id}
          onDragStart={() => begin(prompt.id)}
          onDragOver={(event) => {
            event.preventDefault();
            over(prompt.id);
          }}
          onDrop={(event) => event.preventDefault()}
          onDragEnd={end}
        >
          {canReorder ? (
            <button
              type="button"
              aria-label={`Reorder prompt ${prompt.id}`}
              onMouseDown={() => setArmed(prompt.id)}
              onMouseUp={() => setArmed(null)}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  nudge(prompt.id, -1);
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  nudge(prompt.id, 1);
                }
              }}
              className="text-muted-foreground/0 group-hover/row:text-muted-foreground hover:text-foreground flex w-5 cursor-grab justify-center transition-colors focus-visible:text-foreground active:cursor-grabbing"
            >
              <GripVertical className="size-4" />
            </button>
          ) : (
            <span className="w-5 shrink-0" aria-hidden="true" />
          )}

          <div className="min-w-0 flex-1">
            <PromptItem prompt={prompt} {...itemProps} />
          </div>
        </div>
      ))}
    </div>
  );
}
