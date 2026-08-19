import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, GitBranch, ListTodo, PanelLeft, Sparkles } from "lucide-react";
import { api } from "./api.js";
import Composer from "./Composer.jsx";
import EnhancePanel from "./EnhancePanel.jsx";
import PromptItem from "./PromptItem.jsx";
import Queue from "./Queue.jsx";
import Sidebar, { SidebarBrand, SidebarNav } from "./Sidebar.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
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

function SectionHeading({ children, count, aside, className }) {
  return (
    <div
      className={cn(
        "text-muted-foreground flex h-7 items-center gap-2 text-[11px] font-medium tracking-wider uppercase",
        className
      )}
    >
      {children}
      {count !== undefined && count > 0 && (
        <Badge variant="secondary" className="min-w-5 justify-center px-1.5 tabular-nums">
          {count}
        </Badge>
      )}
      {aside && <span className="ml-auto text-[11px] normal-case">{aside}</span>}
    </div>
  );
}

// One vertical rhythm for every block on the page: 28px between sections,
// 10px between a heading and its list.
function Section({ children, className }) {
  return <section className={cn("mt-7 flex flex-col gap-2.5", className)}>{children}</section>;
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
  const [navOpen, setNavOpen] = useState(false);
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

  const navProps = {
    projects,
    active: selected,
    currentProject: CURRENT,
  };

  const tabClass =
    // The base trigger is flex-1, which stretches the tabs to split the header
    // between them. flex-none at every width keeps both hugging their labels on
    // the left, so the row starts at the same place as everything below it.
    "data-active:text-foreground flex-none gap-1.5 px-2.5 text-[13px]";

  return (
    <TooltipProvider delay={400}>
      <div className="grid h-dvh grid-cols-1 md:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="hidden min-h-0 md:block">
          <Sidebar {...navProps} onSelect={setSelected} />
        </div>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-col gap-0">
          {/* Sticky so switching tabs and reading the queue never costs a
              scroll back to the top. */}
          <header className="bg-background/80 supports-backdrop-filter:backdrop-blur sticky top-0 z-30 shrink-0 border-b">
            <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 pt-3 sm:px-6">
              <Sheet open={navOpen} onOpenChange={setNavOpen}>
                <SheetTrigger
                  render={<Button variant="ghost" size="icon-sm" aria-label="Projects" />}
                  className="md:hidden"
                >
                  <PanelLeft />
                </SheetTrigger>
                <SheetContent side="left" className="w-72 p-0" showCloseButton={false}>
                  <SheetTitle className="flex h-14 shrink-0 items-center border-b px-4">
                    <SidebarBrand />
                  </SheetTitle>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <SidebarNav
                      {...navProps}
                      onSelect={(value) => {
                        setSelected(value);
                        setNavOpen(false);
                      }}
                    />
                  </div>
                </SheetContent>
              </Sheet>

              <div className="min-w-0 flex-1">
                <h1 className="truncate text-[17px] leading-6 font-semibold tracking-tight">
                  {selected === "" ? "All projects" : basename(selected)}
                </h1>
                <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                  <span className="truncate font-mono">
                    {selected === ""
                      ? `${projects.length} ${projects.length === 1 ? "project" : "projects"}`
                      : shortPath(selected)}
                  </span>
                  {selected === CURRENT && session?.branch && (
                    <span className="inline-flex shrink-0 items-center gap-1 font-mono">
                      <span aria-hidden="true">·</span>
                      <GitBranch className="size-3" />
                      {session.branch}
                    </span>
                  )}
                </p>
              </div>

              <div className="md:hidden">
                <ThemeToggle />
              </div>
            </div>

            <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
              {/* gap-2: at gap-1 the two tabs read as one control rather than
                  two separate targets. */}
              <TabsList variant="line" className="h-9 w-full mt-1 justify-start gap-2 p-0">
                <TabsTrigger value="queue" className={tabClass}>
                  <ListTodo />
                  Queue
                  {groups.pending.length > 0 && (
                    <Badge variant="secondary" className="min-w-5 justify-center px-1.5">
                      {groups.pending.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="enhance" className={tabClass}>
                  <Sparkles />
                  Enhance
                </TabsTrigger>
              </TabsList>
            </div>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto">
            {/* pt-7 matches the gap between sections, so the whole column runs
                on one 28px rhythm from the header down. */}
            <div className="mx-auto w-full max-w-3xl px-4 pt-7 pb-24 sm:px-6">
              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <TabsContent value="queue">
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
                  <Section>
                    <SectionHeading count={groups.inProgress.length}>In progress</SectionHeading>
                    <div className="flex flex-col gap-1.5">
                      {groups.inProgress.map((prompt) => (
                        <PromptItem key={prompt.id} prompt={prompt} {...itemProps} />
                      ))}
                    </div>
                  </Section>
                )}

                <Section>
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
                    <p className="text-muted-foreground rounded-xl border border-dashed px-6 py-10 text-center text-[13px]">
                      {selected === CURRENT
                        ? "Nothing queued. Write a prompt above."
                        : "Nothing queued for this project."}
                    </p>
                  )}
                </Section>

                {groups.done.length > 0 && (
                  <Section>
                    <SectionHeading>
                      <button
                        type="button"
                        onClick={() => setShowDone((value) => !value)}
                        aria-expanded={showDone}
                        className="hover:text-foreground focus-visible:text-foreground -my-1 flex items-center gap-2 py-1 tracking-wider uppercase outline-none"
                      >
                        <ChevronRight
                          className={cn("size-3.5 transition-transform", showDone && "rotate-90")}
                        />
                        Done
                        <Badge
                          variant="secondary"
                          className="min-w-5 justify-center px-1.5 tabular-nums"
                        >
                          {groups.done.length}
                        </Badge>
                      </button>
                    </SectionHeading>
                    {showDone && (
                      <div className="flex flex-col gap-1.5">
                        {groups.done.map((prompt) => (
                          <PromptItem key={prompt.id} prompt={prompt} {...itemProps} />
                        ))}
                      </div>
                    )}
                  </Section>
                )}
              </TabsContent>

              <TabsContent value="enhance">
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
            </div>
          </main>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
