export interface VisualizerDeps {
  ctx: AudioContext;
  analyser: AnalyserNode;
  vizCanvas: HTMLCanvasElement;
}

export function startVisualizer(deps: VisualizerDeps): void {
  const { analyser, vizCanvas } = deps;
  const c = vizCanvas.getContext('2d');
  if (!c) return;
  const data = new Uint8Array(analyser.fftSize);
  const draw = () => {
    requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(data);
    c.fillStyle = '#1a1a1a';
    c.fillRect(0, 0, vizCanvas.width, vizCanvas.height);
    c.lineWidth = 1.5;
    c.strokeStyle = '#f7d000';
    c.beginPath();
    const slice = vizCanvas.width / data.length;
    for (let i = 0; i < data.length; i++) {
      const v = data[i] / 128.0;
      const y = (v * vizCanvas.height) / 2;
      if (i === 0) c.moveTo(0, y); else c.lineTo(i * slice, y);
    }
    c.stroke();
  };
  draw();
}
