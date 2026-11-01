import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Circle, GitBranch, Layers3, LoaderCircle, MessageSquare, TriangleAlert } from 'lucide-react';
import type { Run, TaskSpec } from '../../../../shared/types.ts';
import { taskStages, taskStatus } from '@/lib/execution';
import type { SteeringNote } from '@/lib/steering';

export function ExecutionGraph({ tasks, run, notes, selectedId, onSelect }: {
  tasks: TaskSpec[]; run: Run | null; notes: SteeringNote[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<{ id: string; from: string; to: string; d: string }[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  let stages: TaskSpec[][] = [], error = '';
  try { if (tasks.length) stages = taskStages(tasks); }
  catch (e) { error = e instanceof Error ? e.message : 'Invalid task graph.'; }
  const active = hovered ?? selectedId;

  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || error) return;
    const draw = () => {
      const bounds = element.getBoundingClientRect();
      const buttons = new Map(Array.from(element.querySelectorAll<HTMLButtonElement>('[data-task-id]')).map(button => [button.dataset.taskId!, button.getBoundingClientRect()]));
      setPaths(tasks.flatMap(task => task.dependencies.flatMap(id => {
        const a = buttons.get(id), b = buttons.get(task.id);
        if (!a || !b) return [];
        const vertical = Math.abs(a.left - b.left) < 30;
        const x1 = (vertical ? a.left : a.right) - bounds.left, y1 = a.top + a.height / 2 - bounds.top;
        const x2 = b.left - bounds.left, y2 = b.top + b.height / 2 - bounds.top;
        const middle = (x1 + x2) / 2;
        const d = vertical
          ? `M ${x1} ${y1} C 4 ${y1}, 4 ${y2}, ${x2} ${y2}`
          : `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`;
        return [{ id: JSON.stringify([id, task.id]), from: id, to: task.id, d }];
      })));
    };
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    element.querySelectorAll('[data-task-id]').forEach(button => observer.observe(button));
    draw();
    return () => observer.disconnect();
  }, [tasks, error]);

  if (error) return <div role="alert" className="alert">{error}</div>;
  if (!tasks.length) return <div className="graph-empty"><GitBranch size={24}/><h2>Your implementation starts here</h2><p>Tasks will appear when the shared plan is ready.</p></div>;

  return <section className="execution-tree" aria-label="Execution dependency graph">
    <div className="tree-heading"><div><GitBranch size={15}/><strong>Implementation paths</strong><span>{tasks.length} tasks · {stages.length} stages</span></div><span className="tree-hint">Select a task to inspect or steer <ArrowUpRight size={12}/></span></div>
    <div className="tree-scroll"><div className="tree-canvas" ref={canvas}>
      <svg className="tree-connectors" aria-hidden="true">{paths.map(path => <path key={path.id} d={path.d} className={active === path.from || active === path.to ? 'active' : ''}/>)}</svg>
      {stages.map((stage, index) => <div className="tree-stage" key={index}>
        <div className="stage-label"><span>{String(index + 1).padStart(2, '0')}</span>{index === 0 ? 'Foundation' : stage.length > 1 ? 'In parallel' : index === stages.length - 1 ? 'Deliver' : 'Integrate'}</div>
        <div className="stage-tasks">{stage.map(task => {
          const execution = run?.tasks.find(item => item.id === task.id);
          const queued = notes.filter(note => note.taskId === task.id && note.runId === (run?.id ?? null) && note.status === 'queued').length;
          const Icon = execution?.status === 'completed' ? Check : execution?.status === 'running' ? LoaderCircle : execution?.status === 'failed' ? TriangleAlert : Circle;
          return <button type="button" className={'task-node ' + (selectedId === task.id ? 'selected' : '')} data-task-id={task.id} key={task.id}
            aria-label={`Inspect ${task.title}`} aria-haspopup="dialog"
            onClick={() => onSelect(task.id)} onMouseEnter={() => setHovered(task.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(task.id)} onBlur={() => setHovered(null)}>
            <span className="node-meta"><span>{task.kind === 'reduce' ? <Layers3 size={12}/> : <GitBranch size={12}/>} {task.kind === 'reduce' ? 'Reduce' : 'Map'}</span><ArrowUpRight size={13}/></span>
            <strong>{task.title}</strong>
            <span className="node-description">{task.description.split('. ')[0]}.</span>
            <span className="node-footer"><span><Icon size={11} className={execution?.status === 'running' ? 'animate-spin' : ''}/>{execution ? taskStatus(execution) : 'Planned'}</span><span>{task.dependencies.length ? `${task.dependencies.length} input${task.dependencies.length === 1 ? '' : 's'}` : 'Starts here'}</span></span>
            {queued > 0 && <span className="node-notes"><MessageSquare size={10}/>{queued} instruction{queued === 1 ? '' : 's'} queued</span>}
          </button>;
        })}</div>
      </div>)}
    </div></div>
    <div className="tree-footer"><span><span className="dot"/> {run ? `Run ${run.status}` : 'Plan preview · no run started'}</span><span>Branches are ready independently. Merges wait for every input.</span></div>
  </section>;
}
