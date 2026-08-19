import { useMemo, useState } from "react";
import { Check, Copy, CornerUpLeft, Loader2, Plus, Sparkles } from "lucide-react";
import { api } from "./api.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const CLI_LABEL = { claude: "Claude", codex: "Codex", cursor: "Cursor" };

function Pane({ title, actions, className, children }) {
  return (
    <div
      className={cn(
        "ring-border flex min-w-0 flex-col overflow-hidden rounded-xl ring-1 ring-inset",
        className
      )}
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b pr-2 pl-3.5">
        <span className="text-muted-foreground mr-auto text-[11px] font-medium tracking-wider uppercase">
          {title}
        </span>
        {actions}
      </div>
      {children}
    </div>
  );
}

// A dedicated workspace: draft on the left, the CLI's rewrite on the right, and
// an explicit choice about which one goes into the queue. Keeping both visible
// is the point — the Queue tab's composer deliberately has no Enhance.
export default function EnhancePanel({ project, session, initial = "", onQueue }) {
  const [draft, setDraft] = useState(initial);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [includeContext, setIncludeContext] = useState(true);
  const [copied, setCopied] = useState(false);

  const installed = useMemo(
    () => Object.keys(CLI_LABEL).filter((cli) => session?.cliAvailability?.[cli]),
    [session]
  );
  const [cli, setCli] = useState(null);
  const activeCli = cli && installed.includes(cli) ? cli : installed[0];
  const models = session?.models?.[activeCli] || {};
  const [model, setModel] = useState(null);
  const activeModel = model && models[model] ? model : session?.defaultModel?.[activeCli];

  async function run() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.enhance({
          text: draft,
          cli: activeCli,
          model: activeModel,
          project,
          context: {
            include: includeContext,
            repo: session?.repo,
            branch: session?.branch,
            model: models[activeModel],
          },
        })
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function queue(text) {
    await onQueue(text);
    setDraft("");
    setResult(null);
  }

  if (installed.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          No agent CLI found on your PATH. Install <code className="font-mono">claude</code>,{" "}
          <code className="font-mono">codex</code>, or <code className="font-mono">agent</code> to
          use Enhance.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-muted/40 ring-border flex flex-wrap items-center gap-2 rounded-xl p-2 ring-1 ring-inset">
        <span className="text-muted-foreground flex shrink-0 items-center gap-2 pl-1.5 text-[13px]">
          <Sparkles className="size-3.5" />
          Rewrite with
        </span>

        <Select
          value={activeCli}
          onValueChange={(value) => {
            setCli(value);
            setModel(null); // model aliases are per-CLI
          }}
        >
          <SelectTrigger size="sm" className="w-28">
            {/* Show the label, not the raw cli id. */}
            <SelectValue>{CLI_LABEL[activeCli]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {installed.map((id) => (
              <SelectItem key={id} value={id}>
                {CLI_LABEL[id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {Object.keys(models).length > 1 && (
          <Select value={activeModel} onValueChange={setModel}>
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(models).map((alias) => (
                <SelectItem key={alias} value={alias}>
                  {alias}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {(session?.repo || session?.branch) && (
          <label
            className="text-muted-foreground flex cursor-pointer items-center gap-2 pl-1 text-[13px] select-none"
            title="Send project and branch name along with the prompt"
          >
            <Checkbox checked={includeContext} onCheckedChange={setIncludeContext} />
            project context
          </label>
        )}

        <Button className="ml-auto" size="sm" onClick={run} disabled={!draft.trim() || busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {busy ? "Enhancing" : "Enhance"}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid items-stretch gap-3 lg:grid-cols-2">
        <Pane
          title="Draft"
          className="bg-card"
          actions={
            draft.trim() && (
              <Button variant="ghost" size="sm" onClick={() => queue(draft)} disabled={!project}>
                <Plus />
                Queue
              </Button>
            )
          }
        >
          <Textarea
            value={draft}
            placeholder="Write the rough version here…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") run();
            }}
            className="min-h-[16rem] flex-1 resize-none rounded-none border-0 bg-transparent p-3.5 text-[13.5px] leading-relaxed shadow-none focus-visible:ring-0 lg:min-h-[22rem] dark:bg-transparent"
          />
        </Pane>

        <Pane
          title="Enhanced"
          className={result ? "bg-card" : "bg-muted/40"}
          actions={
            result && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(result);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  }}
                >
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Send it back to the draft side"
                  onClick={() => {
                    setDraft(result);
                    setResult(null);
                  }}
                >
                  <CornerUpLeft />
                  Reuse
                </Button>
                <Button size="sm" onClick={() => queue(result)} disabled={!project}>
                  <Plus />
                  Queue
                </Button>
              </>
            )
          }
        >
          {result ? (
            <pre className="min-h-[16rem] flex-1 overflow-auto p-3.5 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap lg:min-h-[22rem]">
              {result}
            </pre>
          ) : (
            <p className="text-muted-foreground grid min-h-[16rem] flex-1 place-items-center p-6 text-center text-[13px] lg:min-h-[22rem]">
              {busy ? "Waiting on the CLI…" : "The rewritten prompt appears here."}
            </p>
          )}
        </Pane>
      </div>
    </div>
  );
}
