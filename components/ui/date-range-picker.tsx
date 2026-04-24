"use client"

import * as React from "react"
import { Calendar as CalendarIcon, X } from "lucide-react"
import type { DateRange, Matcher } from "react-day-picker"
import { format } from "date-fns"
import { sv } from "date-fns/locale"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DateRangePickerProps {
  value?: DateRange
  onChange: (range: DateRange | undefined) => void
  fromDate?: Date
  toDate?: Date
  defaultMonth?: Date
  placeholder?: string
  className?: string
  numberOfMonths?: number
}

function formatDate(d: Date) {
  return format(d, "d MMM yyyy", { locale: sv })
}

export function DateRangePicker({
  value,
  onChange,
  fromDate,
  toDate,
  defaultMonth,
  placeholder = "Välj datumperiod",
  className,
  numberOfMonths = 2,
}: DateRangePickerProps) {
  const hasRange = Boolean(value?.from)

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              className={cn(
                "h-9 justify-start text-left font-normal",
                !hasRange && "text-muted-foreground"
              )}
            />
          }
        >
          <CalendarIcon className="h-4 w-4" />
          {value?.from ? (
            value.to ? (
              <span>
                {formatDate(value.from)} — {formatDate(value.to)}
              </span>
            ) : (
              <span>{formatDate(value.from)} — …</span>
            )
          ) : (
            <span>{placeholder}</span>
          )}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-auto p-0"
        >
          <Calendar
            mode="range"
            selected={value}
            onSelect={onChange}
            defaultMonth={value?.from ?? defaultMonth}
            numberOfMonths={numberOfMonths}
            disabled={
              [
                ...(fromDate ? [{ before: fromDate }] : []),
                ...(toDate ? [{ after: toDate }] : []),
              ] as Matcher[]
            }
            startMonth={fromDate}
            endMonth={toDate}
            weekStartsOn={1}
            locale={sv}
          />
        </PopoverContent>
      </Popover>
      {hasRange && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onChange(undefined)}
          title="Rensa datumfilter"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}
