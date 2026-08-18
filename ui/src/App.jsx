import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, GitBranch, ListTodo, Sparkles } from "lucide-react";
import { api } from "./api.js";
import Composer from "./Composer.jsx";
import EnhancePanel from "./EnhancePanel.jsx";
import PromptItem from "./PromptItem.jsx";
import Queue from "./Queue.jsx";
import Sidebar from "./Sidebar.jsx";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// The CLI opens the page with the directory it was run from. Without it there
// is no project to queue against, so the composer stays disabled.
const CURRENT = new URLSearchParams(window.location.search).get("project") || "";

const POLL_MS = 2000;

function shortPath(project) {
  return project.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

function basename(project) {
  return project.split("/").filter(Boolean).pop() || project;
}

function SectionHeading({ children, count, aside }) {
  return (
    <h2 className="text-muted-foreground mt-7 mb-2.5 flex items-center gap-2 text-[11px] font-medium tracking-wider uppercase">
      {children}
      {count !== undefined && (
        <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 tabular-nums">
          {count}
        </Badge>
      )}
      {aside && <span className="ml-auto text-[11px] normal-case">{aside}</span>}
    </h2>
  );
}

export default function App() {
  const [prompts, setPrompts] = useState([]);
  const [projects, setProjects] = useState([]);
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState("queue");
  const [seed, setSeed] = useState("");
  // "" means the All-projects view; otherwise an absolute project path.
  const [selected, setSelected] = useState(CURRENT);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [showDone, setShowDone] = useState(false);
  // Suppress the poll's state write while a mutation is in flight or a drag is
  // underway, so a stale response cannot overwrite what the user just did.
  const busy = useRef(0);
  const dragging = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [nextPrompts, nextProjects] = await Promise.all([
        api.listPrompts(selected),
        api.listProjects(),
      ]);
      if (busy.current === 0 && !dragging.current) {
        setPrompts(nextPrompts);
        setProjects(nextProjects);
      }
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoaded(true);
    }
  }, [selected]);

  useEffect(() => {
    refresh();
    // Poll so prompts an agent claims or completes show up without a reload —
    // the agent writes to the same database from its own process.
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    // Which CLIs exist and what models they offer changes only across restarts.
    api.session(CURRENT).then(setSession).catch(() => setSession(null));
  }, []);

  const mutate = useCallback(
    async (fn) => {
      busy.current += 1;
      try {
        await fn();
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        busy.current -= 1;
      }
      await refresh();
    },
    [refresh]
  );

  const groups = useMemo(
    () => ({
      pending: prompts.filter((p) => p.status === "pending"),
      inProgress: prompts.filter((p) => p.status === "in_progress"),
      done: prompts.filter((p) => p.status === "done").reverse(),
    }),
    [prompts]
  );

  const itemProps = {
    showProject: selected === "",
    projects,
    onEdit: (id, text) => mutate(() => api.editPrompt(id, text)),
    onRemove: (id) => mutate(() => api.removePrompt(id)),
    onStatus: (id, status) => mutate(() => api.setStatus(id, status)),
    onMove: (id, project) => mutate(() => api.movePrompt(id, project)),
  };

  const addPrompt = (text) => mutate(() => api.addPrompt(CURRENT, text));

  return (
    <TooltipProvider delayDuration={300}>
      <div className="grid h-screen grid-cols-1 md:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="hidden md:block">
          <Sidebar
            projects={projects}
            active={selected}
            currentProject={CURRENT}
            onSelect={setSelected}
          />
        </div>

        <main className="overflow-y-auto">
          <div className="mx-auto max-w-4xl px-6 pt-7 pb-24">
            <Tabs value={tab} onValueChange={setTab}>
              <header className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b pb-0">
                <div className="pb-4">
                  <h1 className="text-[22px] font-semibold tracking-tight">
                    {selected === "" ? "All projects" : basename(selected)}
                  </h1>
                  <p className="text-muted-foreground mt-0.5 flex items-center gap-2 font-mono text-xs">
                    {selected === "" ? `${projects.length} projects` : shortPath(selected)}
                    {selected === CURRENT && session?.branch && (
                      <span className="inline-flex items-center gap-1 rounded-full border px-2 py-px">
                        <GitBranch className="size-3" />
                        {session.branch}
                      </span>
                    )}
                  </p>
                </div>

                <TabsList className="h-auto gap-1 bg-transparent p-0">
                  <TabsTrigger
                    value="queue"
                    className="data-[state=active]:border-b-primary rounded-none border-0 border-b-2 border-transparent px-3 pb-3 shadow-none data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent"
                  >
                    <ListTodo className="size-4" />
                    Queue
                    {groups.pending.length > 0 && (
                      <Badge variant="secondary" className="ml-1 h-5 min-w-5 justify-center px-1.5">
                        {groups.pending.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="enhance"
                    className="data-[state=active]:border-b-primary rounded-none border-0 border-b-2 border-transparent px-3 pb-3 shadow-none data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent"
                  >
                    <Sparkles className="size-4" />
                    Enhance
                  </TabsTrigger>
                </TabsList>
              </header>

              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <TabsContent value="queue" className="mt-0">
                <Composer
                  project={CURRENT}
                  projectName={basename(CURRENT)}
                  onAdd={addPrompt}
                  onEnhance={(text) => {
                    // Carry the half-written draft across so switching tabs
                    // never costs the user their text.
                    setSeed(text);
                    setTab("enhance");
                  }}
                />

                {groups.inProgress.length > 0 && (
                  <section>
                    <SectionHeading count={groups.inProgress.length}>In progress</SectionHeading>
                    <div className="space-y-1 pl-5">
                      {groups.inProgress.map((prompt) => (
                        <PromptItem key={prompt.id} prompt={prompt} {...itemProps} />
                      ))}
                    </div>
                  </section>
                )}

                <section>
                  <SectionHeading
                    count={groups.pending.length}
                    /* Renumbering is per project — dragging across a mixed list
                       would silently reorder other projects' queues too. */
                    aside={
                      selected === "" && groups.pending.length > 1
                        ? "pick a project to reorder"
                        : undefined
                    }
                  >
                    Queued
                  </SectionHeading>

                  <Queue
                    prompts={groups.pending}
                    canReorder={selected !== ""}
                    itemProps={itemProps}
                    onDraggingChange={(value) => {
                      dragging.current = value;
                    }}
                    onReorder={(ids) => mutate(() => api.reorder(ids))}
                  />

                  {loaded && groups.pending.length === 0 && (
                    <p className="text-muted-foreground rounded-xl border border-dashed p-8 text-center text-[13px]">
                      {selected === CURRENT
                        ? "Nothing queued. Write a prompt above."
                        : "Nothing queued for this project."}
                    </p>
                  )}
                </section>

                {groups.done.length > 0 && (
                  <section>
                    <SectionHeading>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowDone((value) => !value)}
                        className="text-muted-foreground -ml-2 h-7 gap-1.5 text-[11px] font-medium tracking-wider uppercase"
                      >
                        <ChevronRight
                          className={cn("size-3.5 transition-transform", showDone && "rotate-90")}
                        />
                        Done
                        <Badge variant="secondary" className="ml-1 h-5 min-w-5 justify-center px-1.5">
                          {groups.done.length}
                        </Badge>
                      </Button>
                    </SectionHeading>
                    {showDone && (
                      <div className="space-y-1 pl-5">
                        {groups.done.map((prompt) => (
                          <PromptItem key={prompt.id} prompt={prompt} {...itemProps} />
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </TabsContent>

              <TabsContent value="enhance" className="mt-0">
                <EnhancePanel
                  key={seed}
                  project={CURRENT}
                  session={session}
                  initial={seed}
                  onQueue={async (text) => {
                    await addPrompt(text);
                    setTab("queue");
                  }}
                />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
