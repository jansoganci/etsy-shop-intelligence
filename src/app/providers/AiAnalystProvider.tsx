import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { sendChatMessage } from "../../data/api/ai.api";
import { DEFAULT_AI_MODEL, type AiModel, type ChatMessage } from "../../data/types/ai";

type AiAnalystContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  model: AiModel;
  setModel: (model: AiModel) => void;
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (content: string, detailed?: boolean) => Promise<void>;
  clearConversation: () => void;
};

const AiAnalystContext = createContext<AiAnalystContextValue | null>(null);

function createId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AiAnalystProvider({ children }: PropsWithChildren) {
  const [isOpen, setIsOpen] = useState(false);
  const [model, setModel] = useState<AiModel>(DEFAULT_AI_MODEL);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.toggle("ai-panel-open", isOpen);
    const timeout = window.setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 260);
    return () => window.clearTimeout(timeout);
  }, [isOpen]);

  const open = useCallback(() => {
    setModel(DEFAULT_AI_MODEL);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  const toggle = useCallback(() => {
    setIsOpen((current) => {
      if (!current) {
        setModel(DEFAULT_AI_MODEL);
      }
      return !current;
    });
  }, []);

  const clearConversation = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const sendMessage = useCallback(
    async (content: string, detailed = false) => {
      const trimmed = content.trim();
      if (!trimmed || isLoading) {
        return;
      }

      const userMessage: ChatMessage = { id: createId(), role: "user", content: trimmed };
      const nextMessages = [...messages, userMessage];
      setMessages(nextMessages);
      setIsLoading(true);
      setError(null);

      try {
        const response = await sendChatMessage(model, nextMessages, detailed);
        setMessages((current) => [
          ...current,
          { id: createId(), role: "assistant", content: response.message },
        ]);
      } catch (reason: unknown) {
        const message = reason instanceof Error ? reason.message : "AI cevap üretemedi.";
        setError(message);
        setMessages((current) => [
          ...current,
          { id: createId(), role: "assistant", content: message, isError: true },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, model, isLoading],
  );

  const value = useMemo(
    () => ({
      isOpen,
      open,
      close,
      toggle,
      model,
      setModel,
      messages,
      isLoading,
      error,
      sendMessage,
      clearConversation,
    }),
    [isOpen, open, close, toggle, model, messages, isLoading, error, sendMessage, clearConversation],
  );

  return <AiAnalystContext.Provider value={value}>{children}</AiAnalystContext.Provider>;
}

export function useAiAnalyst(): AiAnalystContextValue {
  const context = useContext(AiAnalystContext);
  if (!context) {
    throw new Error("useAiAnalyst must be used within an AiAnalystProvider.");
  }
  return context;
}
