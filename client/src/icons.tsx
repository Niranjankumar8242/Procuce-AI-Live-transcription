import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement>;
const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const MicIcon = (props: Props) => <svg {...base} {...props}><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>;
export const HistoryIcon = (props: Props) => <svg {...base} {...props}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>;
export const SearchIcon = (props: Props) => <svg {...base} {...props}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>;
export const EditIcon = (props: Props) => <svg {...base} {...props}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>;
export const TrashIcon = (props: Props) => <svg {...base} {...props}><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v5M14 11v5"/></svg>;
export const ClockIcon = (props: Props) => <svg {...base} {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
export const SparkIcon = (props: Props) => <svg {...base} {...props}><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/></svg>;
export const MenuIcon = (props: Props) => <svg {...base} {...props}><path d="M4 7h16M4 12h16M4 17h16"/></svg>;
export const XIcon = (props: Props) => <svg {...base} {...props}><path d="m6 6 12 12M18 6 6 18"/></svg>;
