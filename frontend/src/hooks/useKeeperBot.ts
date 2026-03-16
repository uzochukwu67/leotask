import { useState, useEffect, useCallback } from 'react';
import { BOT_API } from '@/utils/config';

export interface BotTask {
  taskId: string;
  recipient: string;
  amount: string;        // microcredits
  triggerBlock: string;
  currentBlock: string;
  ready: boolean;
  blocksRemaining: string;
  registeredAt: string;
}

export interface BotHealth {
  online: boolean;
  currentBlock: number;
  pendingTasks: number;
  programId: string;
  upSince: string;
}

export function useKeeperBot() {
  const [health, setHealth] = useState<BotHealth | null>(null);
  const [tasks, setTasks] = useState<BotTask[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [healthRes, tasksRes] = await Promise.all([
        fetch(`${BOT_API}/health`),
        fetch(`${BOT_API}/api/tasks`),
      ]);

      if (healthRes.ok) {
        const h = await healthRes.json();
        console.log('Keeper Bot Health:', h);
        setHealth({
          online: true,
          currentBlock: parseInt(h.currentBlock || '0'),
          pendingTasks: h.pendingTasks ?? 0,
          programId: h.programId ?? '',
          upSince: h.upSince ?? '',
        });
      } else {
        setHealth({ online: false, currentBlock: 0, pendingTasks: 0, programId: '', upSince: '' });
      }

      if (tasksRes.ok) {
        const d = await tasksRes.json();
        setTasks(d.tasks ?? []);
      }
    } catch {
      setHealth({ online: false, currentBlock: 0, pendingTasks: 0, programId: '', upSince: '' });
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const registerTask = useCallback(async (task: {
    taskId: string;
    recipient: string;
    amount: string;
    triggerBlock: number;
  }): Promise<boolean> => {
    try {
      const res = await fetch(`${BOT_API}/api/tasks/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(task),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  // Poll every 10 seconds
  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 10000);
    return () => clearInterval(id);
  }, [fetchAll]);

  return { health, tasks, loading, refresh: fetchAll, registerTask };
}
