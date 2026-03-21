import clsx from "clsx";

interface StatusBadgeProps {
  status: string | null;
  variant?: "track" | "band" | "default";
}

export function StatusBadge({ status, variant = "default" }: StatusBadgeProps) {
  if (!status) return null;

  let colors = "bg-gray-100 text-gray-700 border-gray-200";

  if (variant === "track") {
    switch (status) {
      case "Fast":
        colors = "bg-purple-100 text-purple-700 border-purple-200";
        break;
      case "Normal":
        colors = "bg-green-100 text-green-700 border-green-200";
        break;
      case "Slow":
        colors = "bg-yellow-100 text-yellow-700 border-yellow-200";
        break;
      case "No promotion":
        colors = "bg-red-50 text-red-600 border-red-100";
        break;
    }
  } else if (variant === "band") {
    switch (status) {
      case "In band":
        colors = "bg-emerald-100 text-emerald-700 border-emerald-200";
        break;
      case "Under":
        colors = "bg-blue-100 text-blue-700 border-blue-200";
        break;
      case "Over":
        colors = "bg-orange-100 text-orange-700 border-orange-200";
        break;
    }
  }

  return (
    <span
      className={clsx(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border",
        colors
      )}
    >
      {status}
    </span>
  );
}
