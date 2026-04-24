"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker, getDefaultClassNames } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: cn(defaultClassNames.months, "relative flex flex-col gap-4 sm:flex-row sm:gap-6"),
        month: cn(defaultClassNames.month, "space-y-4"),
        month_caption: cn(
          defaultClassNames.month_caption,
          "flex h-9 items-center justify-center text-sm font-medium"
        ),
        caption_label: cn(defaultClassNames.caption_label, "text-sm font-medium"),
        nav: cn(
          defaultClassNames.nav,
          "pointer-events-none absolute inset-x-0 top-0 z-10 flex h-9 items-center justify-between px-1 [&>button]:pointer-events-auto"
        ),
        button_previous: cn(
          buttonVariants({ variant: "outline", size: "icon-sm" }),
          "bg-transparent opacity-70 hover:opacity-100"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline", size: "icon-sm" }),
          "bg-transparent opacity-70 hover:opacity-100"
        ),
        month_grid: cn(defaultClassNames.month_grid, "w-full border-collapse"),
        weekdays: cn(defaultClassNames.weekdays, "flex"),
        weekday: cn(
          defaultClassNames.weekday,
          "w-9 text-[0.8rem] font-normal text-muted-foreground"
        ),
        week: cn(defaultClassNames.week, "mt-2 flex w-full"),
        day: cn(
          defaultClassNames.day,
          "relative h-9 w-9 p-0 text-center text-sm focus-within:relative focus-within:z-20"
        ),
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal"
        ),
        range_start: cn(
          defaultClassNames.range_start,
          "rounded-l-md bg-primary text-primary-foreground"
        ),
        range_end: cn(
          defaultClassNames.range_end,
          "rounded-r-md bg-primary text-primary-foreground"
        ),
        range_middle: cn(
          defaultClassNames.range_middle,
          "rounded-none bg-accent text-accent-foreground"
        ),
        selected: cn(
          defaultClassNames.selected,
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground"
        ),
        today: cn(
          defaultClassNames.today,
          "[&>button]:bg-accent [&>button]:text-accent-foreground rounded-md"
        ),
        outside: cn(
          defaultClassNames.outside,
          "text-muted-foreground opacity-50"
        ),
        disabled: cn(defaultClassNames.disabled, "text-muted-foreground opacity-50"),
        hidden: cn(defaultClassNames.hidden, "invisible"),
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName, ...chevronProps }) => {
          const Icon = orientation === "left" ? ChevronLeft : ChevronRight
          return (
            <Icon
              className={cn("h-4 w-4", chevronClassName)}
              {...chevronProps}
            />
          )
        },
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
