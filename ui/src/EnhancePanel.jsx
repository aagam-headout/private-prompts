import { useMemo, useState } from "react";
import { ArrowRight, Check, Copy, CornerUpLeft, Loader2, Plus, Sparkles } from "lucide-react";
import { api } from "./api.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const CLI_LABEL = { claude: "Claude", codex: "Codex", cursor: "Cursor" };

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
    <div className="space-y-4">
      <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-xl border p-2.5">
        <span className="text-muted-foreground flex items-center gap-2 pl-1 text-[13px] font-medium">
          <Sparkles className="size-4" />
          Rewrite with
        </span>

        <Select
          value={activeCli}
          onValueChange={(value) => {
            setCli(value);
            setModel(null); // model aliases are per-CLI
          }}
        >
          <SelectTrigger size="sm" className="w-[110px]">
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
            <SelectTrigger size="sm" className="w-[120px]">
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
            className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-[13px] select-none"
            title="Send project and branch name along with the prompt"
          >
            <input
              type="checkbox"
              checked={includeContext}
              onChange={(event) => setIncludeContext(event.target.checked)}
              className="accent-primary size-3.5"
            />
            project context
          </label>
        )}

        <Button className="ml-auto" size="sm" onClick={run} disabled={!draft.trim() || busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {busy ? "Enhancing" : "Enhance"}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="flex-row items-center gap-1 space-y-0 border-b px-3 py-2">
            <CardTitle className="text-muted-foreground mr-auto text-[11px] font-medium tracking-wider uppercase">
              Draft
            </CardTitle>
            {draft.trim() && (
              <Button variant="ghost" size="sm" onClick={() => queue(draft)} disabled={!project}>
                <Plus className="size-3.5" />
                Queue this
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <Textarea
              value={draft}
              placeholder="Write the rough version here…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") run();
              }}
              className="min-h-[340px] resize-none rounded-none border-0 p-4 font-mono text-[13px] shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </CardContent>
        </Card>

        <div className="text-muted-foreground grid place-items-center max-lg:rotate-90">
          <ArrowRight className="size-4" />
        </div>

        <Card className={`gap-0 overflow-hidden py-0 ${result ? "" : "bg-muted/40"}`}>
          <CardHeader className="flex-row items-center gap-1 space-y-0 border-b px-3 py-2">
            <CardTitle className="text-muted-foreground mr-auto text-[11px] font-medium tracking-wider uppercase">
              Enhanced
            </CardTitle>
            {result && (
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
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
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
                  <CornerUpLeft className="size-3.5" />
                  Reuse
                </Button>
                <Button size="sm" onClick={() => queue(result)} disabled={!project}>
                  <Plus className="size-3.5" />
                  Queue this
                </Button>
              </>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {result ? (
              <pre className="min-h-[340px] overflow-auto p-4 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap">
                {result}
              </pre>
            ) : (
              <p className="text-muted-foreground grid min-h-[340px] place-items-center p-4 text-center text-[13px]">
                {busy ? "Waiting on the CLI…" : "The rewritten prompt appears here."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
