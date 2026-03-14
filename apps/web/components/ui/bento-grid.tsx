import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const BentoGrid = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "grid w-full auto-rows-[22rem] grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3",
        className
      )}
    >
      {children}
    </div>
  );
};

export const BentoCard = ({
  name,
  className,
  background,
  Icon,
  description,
  href,
  cta,
  gradient,
  iconColor,
  glowColor,
}: {
  name: string;
  className: string;
  background?: ReactNode;
  Icon?: any;
  description: string;
  href?: string;
  cta?: string;
  gradient?: string;
  iconColor?: string;
  glowColor?: string;
}) => (
  <div
    key={name}
    className={cn(
      "group relative col-span-1 flex flex-col justify-between overflow-hidden rounded-xl",
      "border border-primary/20 backdrop-blur-sm transition-all duration-300",
      "bg-gradient-to-br",
      gradient || "from-surface-elevated/50 to-surface/50",
      glowColor,
      className
    )}
  >
    {/* Background gradient overlay */}
    <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

    {background && <div>{background}</div>}

    <div className="relative z-10 flex transform-gpu flex-col gap-3 p-6 transition-all duration-300">
      {Icon && (
        <div className="mb-2">
          <Icon className={cn(
            "h-12 w-12 transition-all duration-300 ease-in-out group-hover:scale-110",
            iconColor || "text-primary"
          )} />
        </div>
      )}
      <h3 className="text-xl font-semibold text-foreground">
        {name}
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>

    <div
      className={cn(
        "relative z-10 flex w-full transform-gpu flex-row items-center p-6 pt-0 opacity-0 transition-all duration-300 group-hover:opacity-100"
      )}
    >
      {href && (
        <a
          href={href}
          className={cn(
            "text-sm font-medium transition-colors",
            iconColor || "text-primary",
            "hover:underline"
          )}
        >
          {cta || "Learn more →"}
        </a>
      )}
    </div>
  </div>
);
