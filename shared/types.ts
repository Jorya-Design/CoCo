export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';
export interface User { id: string; name: string; email: string | null }
export interface Message { id: string; role: 'user' | 'agent' | 'system'; name: string; text: string; at: number }
export interface TaskSpec { id: string; title: string; description: string; kind: 'map' | 'reduce'; dependencies: string[] }
export interface Task extends TaskSpec { status: TaskStatus; workerId?: string; threadId?: string; output?: string; error?: string; startedAt?: number; completedAt?: number }
export interface Run { id: string; roomId: string; mode: 'demo' | 'live'; status: 'running' | 'paused' | 'completed' | 'failed'; tasks: Task[]; plan: string; createdAt: number; events: RunEvent[] }
export interface RunEvent { id: string; at: number; taskId?: string; text: string; level: 'info' | 'success' | 'error' }
export interface Worker { id: string; name: string; lastSeen: number; status: 'idle' | 'working'; taskId?: string }
export interface RoomSummary { id: string; title: string; createdAt: number }
export interface RoomState extends RoomSummary { messages: Message[]; answers: string[]; interview: number | null; run: Run | null; workers: Worker[] }
export interface Presence { id: string; name: string; color: string; cursor?: number }
export interface WorkerJob { runId: string; roomId: string; task: Task; plan: string; dependencies: { id: string; title: string; output: string }[] }
