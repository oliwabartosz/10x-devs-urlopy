import { useState } from "react";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AddEmployeeDialog } from "./AddEmployeeDialog";
import { EditEmployeeDialog } from "./EditEmployeeDialog";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { initialsOf } from "@/lib/initials";
import { avatarColor } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import type { Employee } from "@/types";

interface EmployeeManagementSheetProps {
  employees: Employee[];
  currentEmployee: Pick<Employee, "id" | "first_name" | "last_name" | "role">;
}

function RoleBadge({ role }: { role: "employee" | "moderator" }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-[0.04em] uppercase",
        role === "moderator" ? "bg-accent text-accent-foreground" : "text-muted-foreground bg-[#eeeeee]",
      )}
    >
      {role === "moderator" ? "Moderator" : "Pracownik"}
    </span>
  );
}

function EmployeeRow({
  employee,
  colorIndex,
  inactive,
  children,
}: {
  employee: Employee;
  colorIndex: number;
  inactive?: boolean;
  children: React.ReactNode;
}) {
  const fullName = `${employee.first_name} ${employee.last_name}`;
  return (
    <div className="border-b-line-strong flex items-center justify-between gap-3 border-b px-3.5 py-2.5 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            "flex size-[34px] shrink-0 items-center justify-center rounded-full text-xs font-bold",
            inactive ? "text-[#9a9a9a]" : "text-white",
          )}
          style={{ backgroundColor: inactive ? "#dcdcdc" : avatarColor(colorIndex) }}
        >
          {initialsOf(fullName)}
        </span>
        <span className={cn("truncate text-sm", inactive ? "text-muted-foreground" : "font-medium text-black")}>
          {fullName}
        </span>
        <RoleBadge role={employee.role} />
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

export function EmployeeManagementSheet({ employees, currentEmployee }: EmployeeManagementSheetProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);

  const activeEmployees = employees.filter((e) => !e.deleted_at);
  const deactivatedEmployees = employees.filter((e) => !!e.deleted_at);

  const handleRestore = async (employee: Employee) => {
    try {
      const res = await fetch(`/api/employees/${employee.id}/restore`, { method: "POST" });
      if (res.ok) {
        toast.success("Pracownik przywrócony");
        window.location.reload();
      } else {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Nie udało się przywrócić.");
      }
    } catch {
      toast.error("Nie udało się przywrócić.");
    }
  };

  return (
    <>
      <button
        onClick={() => {
          setSheetOpen(true);
        }}
        className="border-primary bg-primary text-primary-foreground hover:border-accent hover:bg-accent hover:text-accent-foreground flex cursor-pointer items-center gap-[9px] rounded-lg border px-[18px] py-[9px] text-sm font-bold transition-colors"
      >
        <Users className="size-4" />
        Pracownicy
      </button>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-[560px]">
          <SheetHeader className="flex flex-row items-center justify-between px-6 py-4 pr-12">
            <SheetTitle className="text-primary text-lg">Zarządzaj pracownikami</SheetTitle>
            <Button
              size="sm"
              onClick={() => {
                setAddOpen(true);
              }}
            >
              Dodaj pracownika
            </Button>
          </SheetHeader>

          <div className="mt-6 space-y-6 px-6 pb-6">
            <section>
              <h3 className="text-muted-foreground mb-3 text-[11px] font-bold tracking-[0.06em] uppercase">
                Aktywni ({activeEmployees.length})
              </h3>
              {activeEmployees.length === 0 ? (
                <p className="text-muted-foreground text-sm">Brak aktywnych pracowników.</p>
              ) : (
                <div className="border-line overflow-hidden rounded-xl border">
                  {activeEmployees.map((emp) => (
                    // Colour index is taken from the full employees array so a person keeps the
                    // same avatar colour here as in Details and Statistics.
                    <EmployeeRow key={emp.id} employee={emp} colorIndex={employees.indexOf(emp)}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditTarget(emp);
                        }}
                      >
                        Edytuj
                      </Button>
                      {emp.id !== currentEmployee.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            setDeleteTarget(emp);
                          }}
                        >
                          Dezaktywuj
                        </Button>
                      )}
                    </EmployeeRow>
                  ))}
                </div>
              )}
            </section>

            {deactivatedEmployees.length > 0 && (
              <section>
                <h3 className="text-muted-foreground mb-3 text-[11px] font-bold tracking-[0.06em] uppercase">
                  Nieaktywni ({deactivatedEmployees.length})
                </h3>
                <div className="border-line overflow-hidden rounded-xl border">
                  {deactivatedEmployees.map((emp) => (
                    <EmployeeRow key={emp.id} employee={emp} colorIndex={employees.indexOf(emp)} inactive>
                      <Button size="sm" variant="ghost" onClick={() => handleRestore(emp)}>
                        Przywróć
                      </Button>
                    </EmployeeRow>
                  ))}
                </div>
              </section>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AddEmployeeDialog open={addOpen} onOpenChange={setAddOpen} />
      {editTarget && (
        <EditEmployeeDialog
          key={editTarget.id}
          open={!!editTarget}
          onOpenChange={(o) => {
            if (!o) setEditTarget(null);
          }}
          employee={editTarget}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(o) => {
            if (!o) setDeleteTarget(null);
          }}
          employee={deleteTarget}
        />
      )}
    </>
  );
}
