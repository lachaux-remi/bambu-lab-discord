/** Utility type to create a range of integers from F to T */
export type IntRange<F extends number, T extends number> = Exclude<Enumerate<T>, Enumerate<F>>;

/** String representation of a number */
export type StringNumber = `${number}`;

/** Helper type for IntRange */
export type Enumerate<N extends number, Accumulator extends number[] = []> = Accumulator["length"] extends N
  ? Accumulator[number]
  : Enumerate<N, [...Accumulator, Accumulator["length"]]>;

/** Hex color string */
export type HexColor = `#${string}`;
