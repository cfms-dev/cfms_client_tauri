
class EventLogImpl {
  entries = $state<Array<{ time: Date; text: string; type: string }>>([]);

  push(type: string, text: string) {
    this.entries = [
      { time: new Date(), text, type },
      ...this.entries.slice(0, 49),
    ];
  }
}

export const eventLog = new EventLogImpl();
