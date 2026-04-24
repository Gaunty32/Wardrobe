import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { Scene6 } from './video_scenes/Scene6';

export const SCENE_DURATIONS = {
  hook: 4000,
  problem: 5000,
  sales: 8000,
  production: 10000,
  portal: 10000,
  close: 8000,
};

const SCENE_COMPONENTS: Record<string, React.ComponentType> = {
  hook: Scene1,
  problem: Scene2,
  sales: Scene3,
  production: Scene4,
  portal: Scene5,
  close: Scene6,
};

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentScene, currentSceneKey } = useVideoPlayer({ durations, loop });

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '') as keyof typeof SCENE_DURATIONS;
  const sceneIndex = Object.keys(SCENE_DURATIONS).indexOf(baseSceneKey);
  const SceneComponent = SCENE_COMPONENTS[baseSceneKey];

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-950 text-slate-50">
      {/* Persistent background orbs */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.div
          className="absolute w-[60vw] h-[60vw] rounded-full opacity-10 blur-[80px]"
          style={{ background: 'radial-gradient(circle, #0ea5e9, transparent)' }}
          animate={{ x: ['-20%', '50%', '10%'], y: ['-10%', '30%', '60%'], scale: [1, 1.2, 0.8] }}
          transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute w-[50vw] h-[50vw] rounded-full opacity-10 blur-[80px] right-0 bottom-0"
          style={{ background: 'radial-gradient(circle, #06b6d4, transparent)' }}
          animate={{ x: ['20%', '-40%', '0%'], y: ['20%', '-20%', '10%'], scale: [0.8, 1.1, 1] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
            backgroundSize: '4vw 4vw',
          }}
        />
      </div>

      {/* Progress bar */}
      <motion.div
        className="absolute bottom-0 left-0 w-full h-[2px] bg-gradient-to-r from-sky-500 to-cyan-400 z-10"
        animate={{
          scaleX: (sceneIndex + 1) / Object.keys(SCENE_DURATIONS).length,
          opacity: baseSceneKey === 'close' ? 0 : 1,
        }}
        style={{ originX: 0 }}
        transition={{ duration: 1, ease: 'easeInOut' }}
      />

      {/* Scene content */}
      <AnimatePresence mode="popLayout">
        {SceneComponent && <SceneComponent key={currentSceneKey} />}
      </AnimatePresence>
    </div>
  );
}
