import { useState, useEffect, useCallback } from 'react';
import { MT_BOT_API } from '@/utils/config';

export interface MtTask {
  taskId:       string;
  recipient:    string;
  amount:       string;   // raw base units (u128)
  triggerBlock: string;
  tokenType:    string;   // '0' = ALEO, '1' = ARC-20
  tokenId:      string;
  status:       'pending' | 'executing' | 'done' | 'failed';
  txId:         string | null;
  discoveredAt: string;
}

export interface MtBotHealth {
  online:       boolean;
  currentBlock: number;
  programId:    string;
  scannerReady: boolean;
  tasks: {
    total:   number;
    pending: number;
    ready:   number;
    done:    number;
    failed:  number;
  };
  upSince: string;
}

export function useMultitokenBot() {
  const [health, setHealth] = useState<MtBotHealth | null>(null);
  const [tasks, setTasks]   = useState<MtTask[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [healthRes, tasksRes] = await Promise.all([
        fetch(`${MT_BOT_API}/health`),
        fetch(`${MT_BOT_API}/api/tasks`),
      ]);

      if (healthRes.ok) {
        const h = await healthRes.json();
        setHealth({
          online:       true,
          currentBlock: parseInt(h.currentBlock || '0'),
          programId:    h.programId ?? '',
          scannerReady: h.scannerReady ?? false,
          tasks:        h.tasks ?? { total: 0, pending: 0, ready: 0, done: 0, failed: 0 },
          upSince:      h.upSince ?? '',
        });
      } else {
        setHealth(null);
      }

      if (tasksRes.ok) {
        const d = await tasksRes.json();
        setTasks(d.tasks ?? []);
      }
    } catch {
      setHealth(null);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 15000);
    return () => clearInterval(id);
  }, [fetchAll]);

  return { health, tasks, loading, refresh: fetchAll };
}
