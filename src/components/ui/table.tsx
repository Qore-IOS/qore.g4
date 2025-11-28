"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type TableCtx = {
  headers: string[];
  setHeaders: (h: string[]) => void;
  primaryCols: number[]; // emphasized in mobile
};

const TableContext = React.createContext<TableCtx>({
  headers: [],
  setHeaders: () => {},
  primaryCols: [0, 1],
});

const useTableCtx = () => React.useContext(TableContext);

export const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & { primaryCols?: number[] }
>(({ className, children, primaryCols = [0, 1], ...props }, ref) => {
  const [headers, setHeaders] = React.useState<string[]>([]);
  return (
    <TableContext.Provider value={{ headers, setHeaders, primaryCols }}>
      <div className={cn("relative w-full")}>
        <table
          ref={ref}
          className={cn("q-table w-full caption-bottom text-sm", className)}
          {...props}
        >
          {children}
        </table>
      </div>
    </TableContext.Provider>
  );
});
Table.displayName = "Table";

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

export const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot ref={ref} className={cn("bg-muted/50 font-medium [&>tr]:last:border-b-0", className)} {...props} />
));
TableFooter.displayName = "TableFooter";

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, children, ...props }, ref) => {
  const { headers, primaryCols } = useTableCtx();

  const cells = React.Children.map(children, (child, idx) => {
    if (!React.isValidElement(child)) return child;
    const label = headers[idx] ?? "";
    return React.cloneElement(child as React.ReactElement, {
      "data-label": label,
      "data-primary": primaryCols.includes(idx) ? "true" : "false",
    });
  });

  return (
    <tr
      ref={ref}
      className={cn(
        "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted md:rounded-none",
        className
      )}
      {...props}
    >
      {cells}
    </tr>
  );
});
TableRow.displayName = "TableRow";

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, children, ...props }, ref) => {
  const { headers, setHeaders } = useTableCtx();

  React.useEffect(() => {
    const text =
      (typeof children === "string"
        ? children
        : React.Children.map(children, (c) => (typeof c === "string" ? c : ""))?.join(" ")) || "";
    const label = text.trim();
    const indexAttr = (props as any)?.["data-index"] as number | undefined;
    if (label) {
      setHeaders((prev) => {
        const next = [...prev];
        if (typeof indexAttr === "number") next[indexAttr] = label;
        else next.push(label);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <th
      ref={ref}
      className={cn(
        "h-10 px-4 text-left align-middle font-medium text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
    </th>
  );
});
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("q-td p-4 align-middle [&:has([role=checkbox])]:pr-0", className)}
    {...props}
  />
));
TableCell.displayName = "TableCell";

export const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
));
TableCaption.displayName = "TableCaption";