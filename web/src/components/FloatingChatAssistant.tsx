import React, { useState, useRef, useEffect } from 'react';
import { api } from '../services/api';
import {
  Bot,
  Send,
  Sparkles,
  ShieldCheck,
  Cpu,
  Cloud,
  ChevronDown,
  ChevronUp,
  Database,
  Terminal,
  X,
  Minimize2,
  Maximize2,
  MessageSquare
} from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  sqlQuery?: string;
  sqlResults?: any[];
  proofOfGrounding?: {
    verified: boolean;
    sourceTable: string;
    rowsRetrieved: number;
    dbRole: string;
    statementTimeoutMs: number;
  };
  modelUsed?: string;
  latencySeconds?: number;
  provider?: string;
}

export const FloatingChatAssistant: React.FC = () => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: '¡Hola! Soy el asistente analítico de SismoWatch. Puedo responder preguntas sobre sismicidad consultando en tiempo real la base de datos curada mediante Text-to-SQL de solo lectura y verificación numérica estricta (cero alucinaciones).',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<'local' | 'cloud'>('cloud');
  const [expandedSqlId, setExpandedSqlId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, loading, isOpen]);

  const presetQuestions = [
    '¿Cuál es el sismo con mayor magnitud registrado recientemente?',
    '¿Cuántos eventos hay en total?',
    '¿Hay alguna alerta de tsunami activa?',
    '¿Cuántos sismos pasaron en las ultimas 24h y en qué lugar?',
  ];

  const handleSend = async (questionText?: string) => {
    const textToSend = questionText || input.trim();
    if (!textToSend || loading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const data = await api.askChat(textToSend, provider);

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        sender: 'assistant',
        text: data.reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sqlQuery: data.sql_query,
        sqlResults: data.sql_results,
        proofOfGrounding: {
          verified: data.proof_of_grounding.verified,
          sourceTable: data.proof_of_grounding.source_table,
          rowsRetrieved: data.proof_of_grounding.rows_retrieved,
          dbRole: data.proof_of_grounding.db_role,
          statementTimeoutMs: data.proof_of_grounding.statement_timeout_ms,
        },
        modelUsed: data.model_used,
        latencySeconds: data.latency_seconds,
        provider: data.provider,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        sender: 'assistant',
        text: `Error de consulta: ${err.message || 'No se pudo conectar con el asistente de IA.'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {/* Minimalist Floating Robot Button (Collapsed) */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="group relative flex items-center justify-center w-13 h-13 sm:w-14 sm:h-14 rounded-full bg-gradient-to-tr from-sky-600 via-indigo-600 to-cyan-500 text-white shadow-2xl hover:scale-110 hover:shadow-cyan-500/30 transition-all border border-cyan-400/40 focus:outline-none cursor-pointer"
          title="Asistente IA Grounded"
          aria-label="Abrir Asistente IA"
        >
          <span className="relative flex h-3 w-3 absolute -top-0.5 -right-0.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-slate-900"></span>
          </span>
          <Bot className="w-6 h-6 text-white group-hover:rotate-6 transition-transform" />
        </button>
      )}

      {/* Expanded Floating Assistant Modal/Window */}
      {isOpen && (
        <div className="w-[420px] sm:w-[480px] h-[580px] max-h-[85vh] flex flex-col rounded-2xl border border-slate-700/80 bg-slate-950/95 backdrop-blur-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-6 duration-200">
          {/* Header */}
          <div className="p-3.5 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  Asistente IA Grounded
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    POLP Read-Only
                  </span>
                </h4>
                <p className="text-[10px] text-slate-400">Text-to-SQL sobre Gold con verificación estricta</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Provider Switcher */}
              <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-[10px]">
                <button
                  onClick={() => setProvider('local')}
                  className={`px-2 py-0.5 rounded font-medium transition-colors ${
                    provider === 'local'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Ollama Local (qwen2.5-coder:1.5b)"
                >
                  Local
                </button>
                <button
                  onClick={() => setProvider('cloud')}
                  className={`px-2 py-0.5 rounded font-medium transition-colors ${
                    provider === 'cloud'
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Groq Cloud (qwen/qwen3.8-27b)"
                >
                  Groq
                </button>
              </div>

              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Minimizar asistente"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Suggestions Bar */}
          <div className="px-3 py-2 border-b border-slate-800/60 bg-slate-950/60 flex items-center gap-1.5 overflow-x-auto text-[11px] custom-scrollbar">
            <span className="text-slate-500 whitespace-nowrap font-medium flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-400" />
              Sugerencias:
            </span>
            {presetQuestions.map((q, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(q)}
                className="whitespace-nowrap px-2 py-0.5 rounded-full bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 text-[10px] transition-colors"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 custom-scrollbar text-xs">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2.5 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.sender === 'assistant' && (
                  <div className="w-6 h-6 rounded-md bg-sky-500/10 border border-sky-500/30 text-sky-400 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-3.5 h-3.5" />
                  </div>
                )}

                <div className={`max-w-[85%] space-y-2 ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`p-3 rounded-xl leading-relaxed whitespace-pre-wrap ${
                      msg.sender === 'user'
                        ? 'bg-sky-600 text-white rounded-br-xs'
                        : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-bl-xs'
                    }`}
                  >
                    {msg.text}
                  </div>

                  {/* Proof of Grounding & SQL Inspector */}
                  {msg.proofOfGrounding && (
                    <div className="space-y-1.5 text-[10px]">
                      <div className="flex items-center gap-2 font-mono text-slate-400 px-1">
                        <span className="flex items-center gap-1 text-emerald-400 font-bold">
                          <ShieldCheck className="w-3 h-3 text-emerald-400" />
                          Proof of Grounding: {msg.proofOfGrounding.verified ? 'Verificado' : 'No verificado'}
                        </span>
                        <span>•</span>
                        <span>{msg.modelUsed}</span>
                        <span>•</span>
                        <span>{msg.latencySeconds}s</span>
                      </div>

                      {msg.sqlQuery && (
                        <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950/80">
                          <button
                            onClick={() =>
                              setExpandedSqlId(expandedSqlId === msg.id ? null : msg.id)
                            }
                            className="w-full px-2.5 py-1 text-left flex items-center justify-between font-mono text-slate-400 hover:text-slate-200 bg-slate-900/60"
                          >
                            <span className="flex items-center gap-1.5">
                              <Terminal className="w-3 h-3 text-sky-400" />
                              SQL Ejecutado ({msg.sqlResults?.length || 0} filas)
                            </span>
                            {expandedSqlId === msg.id ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </button>

                          {expandedSqlId === msg.id && (
                            <div className="p-2.5 space-y-2 font-mono text-[10px] border-t border-slate-800 bg-slate-950">
                              <div className="text-sky-300 bg-slate-900 p-2 rounded border border-slate-800 overflow-x-auto">
                                <code>{msg.sqlQuery}</code>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 text-slate-400 text-xs py-2 pl-2">
                <Bot className="w-4 h-4 text-sky-400 animate-bounce" />
                <span className="animate-pulse">Consultando y verificando en curated.v_events_chat...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Footer: Input Bar */}
          <div className="p-3 border-t border-slate-800 bg-slate-900/90">
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 focus-within:border-sky-500/50">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !loading && handleSend()}
                placeholder="Haz una pregunta sobre sismos (ej: ¿Hubo sismos en Chile?)..."
                className="flex-1 bg-transparent border-0 text-slate-100 text-xs focus:outline-none placeholder:text-slate-500"
                disabled={loading}
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || loading}
                className="p-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40 transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
