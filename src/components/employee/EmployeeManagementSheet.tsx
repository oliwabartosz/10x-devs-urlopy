import { useState } from "react";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AddEmployeeDialog } from "./AddEmployeeDialog";
import { EditEmployeeDialog } from "./EditEmployeeDialog";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import type { Employee } from "@/types";

interface EmployeeManagementSheetProps {
  employees: Employee[];
  currentEmployee: Pick<Employee, "id" | "first_name" | "last_name" | "role">;
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
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
      >
        <Users className="h-4 w-4" />
        Pracownicy
      </button>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader className="flex flex-row items-center justify-between px-6 py-4 pr-12">
            <SheetTitle>Zarządzaj pracownikami</SheetTitle>
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
              <h3 className="mb-3 text-sm font-semibold tracking-wide text-gray-500 uppercase">
                Aktywni ({activeEmployees.length})
              </h3>
              {activeEmployees.length === 0 ? (
                <p className="text-sm text-gray-400">Brak aktywnych pracowników.</p>
              ) : (
                <div className="divide-y rounded-md border">
                  {activeEmployees.map((emp) => (
                    <div key={emp.id} className="flex items-center justify-between px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {emp.first_name} {emp.last_name}
                        </span>
                        <RoleBadge role={emp.role} />
                      </div>
                      <div className="flex items-center gap-1">
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
                            className="text-red-600 hover:text-red-700"
                            onClick={() => {
                              setDeleteTarget(emp);
                            }}
                          >
                            Dezaktywuj
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {deactivatedEmployees.length > 0 && (
              <section>
                <h3 className="mb-3 text-sm font-semibold tracking-wide text-gray-500 uppercase">
                  Nieaktywni ({deactivatedEmployees.length})
                </h3>
                <div className="divide-y rounded-md border">
                  {deactivatedEmployees.map((emp) => (
                    <div key={emp.id} className="flex items-center justify-between px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-400">
                          {emp.first_name} {emp.last_name}
                        </span>
                        <RoleBadge role={emp.role} />
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => handleRestore(emp)}>
                        Przywróć
                      </Button>
                    </div>
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

function RoleBadge({ role }: { role: "employee" | "moderator" }) {
  if (role === "moderator") {
    return (
      <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-600">Moderator</span>
    );
  }
  return <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Pracownik</span>;
}
