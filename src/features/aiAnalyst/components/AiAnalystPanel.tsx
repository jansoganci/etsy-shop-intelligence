import { useEffect, useRef, useState } from "react";
import "../ai-analyst.css";
import { ArrowLeft, BrainCircuit, MessageCircle, RotateCcw, X } from "lucide-react";
import { useAiAnalyst } from "../../../app/providers/AiAnalystProvider";
import { AI_MODELS } from "../../../data/types/ai";
import { Button, Select } from "../../../components/ui";
import { MemoryView } from "./MemoryView";

const MODEL_LABELS: Record<string, string> = {
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
};

const STARTER_QUESTIONS = [
  "Bu ay satışlarım neden düştü?",
  "Bu ay en çok hangi ürün güçlendi?",
  "Satışsız günlerin ana nedeni ne görünüyor?",
  "Geçen yılın aynı dönemine göre ne değişti?",
];

export function AiAnalystPanel() {
  const { isOpen, close, toggle, model, setModel, messages, isLoading, sendMessage, clearConversation } =
    useAiAnalyst();
  const [draft, setDraft] = useState("");
  const [isMemoryView, setIsMemoryView] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, isLoading]);

  const handleSend = () => {
    if (!draft.trim() || isLoading) {
      return;
    }
    const content = draft;
    setDraft("");
    void sendMessage(content);
  };

  const handleDetail = () => {
    void sendMessage("Detaylandır", true);
  };

  const handleRetry = () => {
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (lastUser) {
      void sendMessage(lastUser.content);
    }
  };

  const lastMessage = messages[messages.length - 1];

  if (!isOpen) {
    return (
      <button type="button" className="ai-panel-tab" onClick={toggle} aria-label="AI Analyst'i aç">
        <MessageCircle size={18} aria-hidden="true" />
        <span>AI Analyst</span>
      </button>
    );
  }

  if (isMemoryView) {
    return (
      <aside className="ai-panel" aria-label="AI Analyst — Memory">
        <div className="ai-panel__header">
          <button
            type="button"
            className="ai-panel__icon-button"
            onClick={() => setIsMemoryView(false)}
            aria-label="Sohbete dön"
            title="Sohbete dön"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <span className="ai-panel__title">Memory</span>
          <button type="button" className="ai-panel__icon-button" onClick={close} aria-label="Paneli kapat">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <MemoryView />
      </aside>
    );
  }

  return (
    <aside className="ai-panel" aria-label="AI Analyst">
      <div className="ai-panel__header">
        <span className="ai-panel__title">AI Analyst</span>
        <div className="ai-panel__header-actions">
          <Select
            value={model}
            onChange={(event) => setModel(event.target.value as typeof model)}
            options={AI_MODELS.map((value) => ({ value, label: MODEL_LABELS[value] }))}
            aria-label="Model seç"
          />
          <button
            type="button"
            className="ai-panel__icon-button"
            onClick={() => setIsMemoryView(true)}
            aria-label="Memory"
            title="Memory"
          >
            <BrainCircuit size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ai-panel__icon-button"
            onClick={clearConversation}
            aria-label="Yeni konuşma"
            title="Yeni konuşma"
          >
            <RotateCcw size={16} aria-hidden="true" />
          </button>
          <button type="button" className="ai-panel__icon-button" onClick={close} aria-label="Paneli kapat">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="ai-panel__messages" ref={listRef}>
        {messages.length === 0 ? (
          <div className="ai-panel__starters">
            <p>Mağazanla ilgili bir soru sor:</p>
            {STARTER_QUESTIONS.map((question) => (
              <button
                key={question}
                type="button"
                className="ai-panel__starter"
                onClick={() => void sendMessage(question)}
              >
                {question}
              </button>
            ))}
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`ai-panel__bubble ai-panel__bubble--${message.role}${message.isError ? " ai-panel__bubble--error" : ""}`}
            >
              <pre>{message.content}</pre>
            </div>
          ))
        )}

        {isLoading ? (
          <div className="ai-panel__bubble ai-panel__bubble--assistant ai-panel__bubble--loading">
            <span>Düşünüyor…</span>
          </div>
        ) : null}
      </div>

      {!isLoading && lastMessage?.role === "assistant" ? (
        <div className="ai-panel__followups">
          {lastMessage.isError ? (
            <Button type="button" size="sm" onClick={handleRetry}>
              Tekrar dene
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={handleDetail}>
              Detaylandır
            </Button>
          )}
        </div>
      ) : null}

      <div className="ai-panel__composer">
        <textarea
          className="ai-panel__composer-input"
          value={draft}
          placeholder="Mağazamda ne oluyor?"
          rows={2}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
        />
        <Button type="button" variant="primary" onClick={handleSend} disabled={isLoading || !draft.trim()}>
          Gönder
        </Button>
      </div>
    </aside>
  );
}
