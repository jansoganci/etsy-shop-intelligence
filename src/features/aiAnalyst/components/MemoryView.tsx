import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { createMemory, deleteMemory, fetchMemories, updateMemory } from "../../../data/api/memory.api";
import { MEMORY_TYPE_LABELS, MEMORY_TYPES, type MemoryRecord, type MemoryType } from "../../../data/types/memory";
import { Button, Select, Textarea } from "../../../components/ui";
import { formatDateTime } from "../../../utils/dates";

const TYPE_OPTIONS = [
  { value: "", label: "Tümü" },
  ...MEMORY_TYPES.map((type) => ({ value: type, label: MEMORY_TYPE_LABELS[type] })),
];

type MemoryFormValue = { memoryType: MemoryType; content: string };

const EMPTY_FORM: MemoryFormValue = { memoryType: "goal", content: "" };

export function MemoryView() {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<MemoryType | "">("");

  const [isAdding, setIsAdding] = useState(false);
  const [addForm, setAddForm] = useState<MemoryFormValue>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<MemoryFormValue>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    fetchMemories(typeFilter || undefined)
      .then((records) => {
        if (!cancelled) {
          setMemories(records);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Hafıza kayıtları yüklenemedi.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [typeFilter]);

  const handleAddSave = async () => {
    if (!addForm.content.trim() || isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      const memory = await createMemory(addForm);
      setMemories((current) => [memory, ...current]);
      setAddForm(EMPTY_FORM);
      setIsAdding(false);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Hafıza kaydı oluşturulamadı.");
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = (memory: MemoryRecord) => {
    setEditingId(memory.id);
    setEditForm({ memoryType: memory.memoryType, content: memory.content });
  };

  const handleEditSave = async (id: number) => {
    if (!editForm.content.trim() || isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      const memory = await updateMemory(id, editForm);
      setMemories((current) => current.map((item) => (item.id === id ? memory : item)));
      setEditingId(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Hafıza kaydı güncellenemedi.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (memory: MemoryRecord) => {
    if (!window.confirm("Bu kaydı kalıcı olarak silmek istediğinize emin misiniz? Geri alınamaz.")) {
      return;
    }
    try {
      await deleteMemory(memory.id);
      setMemories((current) => current.filter((item) => item.id !== memory.id));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Hafıza kaydı silinemedi.");
    }
  };

  return (
    <div className="memory-view">
      <div className="memory-view__toolbar">
        <Select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as MemoryType | "")}
          options={TYPE_OPTIONS}
          aria-label="Türe göre filtrele"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          icon={<Plus size={14} aria-hidden="true" />}
          onClick={() => setIsAdding((current) => !current)}
        >
          Not Ekle
        </Button>
      </div>

      {isAdding ? (
        <div className="memory-view__form">
          <Select
            value={addForm.memoryType}
            onChange={(event) =>
              setAddForm((current) => ({ ...current, memoryType: event.target.value as MemoryType }))
            }
            options={MEMORY_TYPES.map((type) => ({ value: type, label: MEMORY_TYPE_LABELS[type] }))}
            aria-label="Not türü"
          />
          <Textarea
            value={addForm.content}
            onChange={(event) => setAddForm((current) => ({ ...current, content: event.target.value }))}
            placeholder="Notunuzu yazın..."
            rows={3}
            maxLength={2000}
          />
          <div className="memory-view__form-actions">
            <Button type="button" size="sm" variant="ghost" onClick={() => setIsAdding(false)}>
              İptal
            </Button>
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={() => void handleAddSave()}
              disabled={isSaving || !addForm.content.trim()}
            >
              Kaydet
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <p className="memory-view__error">{error}</p> : null}

      {isLoading ? (
        <p className="memory-view__empty">Yükleniyor…</p>
      ) : memories.length === 0 ? (
        <p className="memory-view__empty">Henüz kayıtlı hafıza yok.</p>
      ) : (
        <ul className="memory-view__list">
          {memories.map((memory) => (
            <li key={memory.id} className="memory-view__card">
              {editingId === memory.id ? (
                <div className="memory-view__form">
                  <Select
                    value={editForm.memoryType}
                    onChange={(event) =>
                      setEditForm((current) => ({ ...current, memoryType: event.target.value as MemoryType }))
                    }
                    options={MEMORY_TYPES.map((type) => ({ value: type, label: MEMORY_TYPE_LABELS[type] }))}
                    aria-label="Not türü"
                  />
                  <Textarea
                    value={editForm.content}
                    onChange={(event) => setEditForm((current) => ({ ...current, content: event.target.value }))}
                    rows={3}
                    maxLength={2000}
                  />
                  <div className="memory-view__form-actions">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      İptal
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={() => void handleEditSave(memory.id)}
                      disabled={isSaving || !editForm.content.trim()}
                    >
                      Kaydet
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="memory-view__card-header">
                    <span className="memory-view__type">{MEMORY_TYPE_LABELS[memory.memoryType]}</span>
                    <span className="memory-view__date">{formatDateTime(memory.updatedAt)}</span>
                  </div>
                  <p className="memory-view__content">{memory.content}</p>
                  <div className="memory-view__card-actions">
                    <Button type="button" size="sm" variant="ghost" onClick={() => startEdit(memory)}>
                      Düzenle
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => void handleDelete(memory)}>
                      Sil
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
