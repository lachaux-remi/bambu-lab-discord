export type IntRange<F extends number, T extends number> = Exclude<Enumerate<T>, Enumerate<F>>;

export type StringNumber = `${number}`;

export type Enumerate<N extends number, Accumulator extends number[] = []> = Accumulator["length"] extends N
  ? Accumulator[number]
  : Enumerate<N, [...Accumulator, Accumulator["length"]]>;

export * from "./client-events";
export * from "./printer-messages";
export * from "./printer-status";
export * from "./project-file";
export * from "./push-status";
