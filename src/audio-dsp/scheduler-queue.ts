interface Entry<T> { frame: number; item: T; }

export class SchedulerQueue<T> {
  private q: Entry<T>[] = [];

  push(frame: number, item: T): void {
    let i = 0;
    while (i < this.q.length && this.q[i].frame < frame) i++;
    this.q.splice(i, 0, { frame, item });
  }

  drainDue(nowFrame: number, fn: (item: T) => void): void {
    while (this.q.length > 0 && this.q[0].frame <= nowFrame) {
      fn(this.q[0].item);
      this.q.shift();
    }
  }
}
