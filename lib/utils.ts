/** Join class names, skipping falsy values (no extra dependencies). */
export function cn(...classes: Array<string | undefined | false | null>) {
  return classes.filter(Boolean).join(" ");
}
