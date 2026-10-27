import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User as UserIcon, ShieldCheck, Terminal, Sparkles, Cpu, Cloud, ChevronDown, ChevronUp, Mic, MicOff } from 'lucide-react';
import { ChatMessage } from '../types';
import { api } from '../services/api';

export const ChatAssistant: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: '¡Hola! Soy el asistente analítico de SismoWatch. Puedo responder tus preguntas sobre sismicidad consultando en tiempo real la base de datos curada mediante Text-to-SQL de solo lectura y verificación numérica estricta (cero alucinaciones).',
      model_used: 'qwen2.5-coder:1.5b'
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<'local' | 'cloud'>('cloud');
  const [expandedSqlId, setExpandedSqlId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);

  const toggleVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Tu navegador no soporta reconocimiento de voz nativo.");
      return;
    }
    if (isListening) {
      setIsListening(false);
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'es-ES';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = () => setIsListening(false);
      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setInput(transcript);
        }
      };
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  const renderFormattedChatText = (text: string) => {
    if (!text) return null;

    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let i = 0;

    const formatInline = (str: string) => {
      const parts = str.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
      return parts.map((part, pIdx) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={pIdx} className="font-bold text-sky-300">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={pIdx} className="px-1 py-0.5 rounded bg-slate-800 font-mono text-[11px] text-cyan-300">
              {part.slice(1, -1)}
            </code>
          );
        }
        return part;
      });
    };

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        elements.push(<div key={`spacer-${i}`} className="h-1" />);
        i++;
        continue;
      }

      // 1. Table Detection (starts and ends with |)
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
          tableLines.push(lines[i].trim());
          i++;
        }

        if (tableLines.length >= 2) {
          const headerCells = tableLines[0]
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim());
          const dataRows = tableLines.slice(1).filter((l) => !/^\|[\s\-:|]+\|$/.test(l));

          elements.push(
            <div key={`table-${i}`} className="my-2.5 overflow-x-auto rounded-lg border border-slate-700/80 bg-slate-950/80 shadow-md">
              <table className="w-full text-left text-[11px] font-mono border-collapse min-w-[320px]">
                <thead className="bg-slate-900 text-sky-300 border-b border-slate-700">
                  <tr>
                    {headerCells.map((h, hIdx) => (
                      <th key={hIdx} className="px-2.5 py-1.5 font-bold uppercase tracking-wider text-[10px]">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-slate-300">
                  {dataRows.map((rowStr, rIdx) => {
                    const cells = rowStr
                      .split('|')
                      .slice(1, -1)
                      .map((c) => c.trim());
                    return (
                      <tr key={rIdx} className="hover:bg-slate-900/50 transition-colors">
                        {cells.map((cell, cIdx) => (
                          <td key={cIdx} className="px-2.5 py-1.5">
                            {formatInline(cell)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
          continue;
        }
      }

      // 2. Blockquote / Alert Banner (> ...)
      if (trimmed.startsWith('>')) {
        const quoteContent = trimmed.replace(/^>\s*/, '');
        const isTsunamiAlert = quoteContent.toLowerCase().includes('tsunami') || quoteContent.includes('🚨') || quoteContent.includes('🌊');
        elements.push(
          <div
            key={`quote-${i}`}
            className={`my-2 p-2.5 rounded-lg border-l-2 text-xs flex items-start gap-2 ${
              isTsunamiAlert
                ? 'bg-rose-500/10 border-rose-500 text-rose-200'
                : 'bg-cyan-500/10 border-cyan-500 text-cyan-200'
            }`}
          >
            <div className="flex-1 leading-relaxed">{formatInline(quoteContent)}</div>
          </div>
        );
        i++;
        continue;
      }

      // 3. Numbered List (1. ...)
      const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
      if (numMatch) {
        elements.push(
          <div key={`num-${i}`} className="flex items-start gap-2 pl-1 py-0.5">
            <span className="px-1.5 py-0.2 rounded-md bg-sky-500/20 text-sky-300 font-mono text-[10px] font-bold shrink-0 mt-0.5">
              {numMatch[1]}
            </span>
            <div className="flex-1 text-slate-200 leading-relaxed">{formatInline(numMatch[2])}</div>
          </div>
        );
        i++;
        continue;
      }

      // 4. Bullet List (- ... or * ...)
      if (/^[*-]\s+/.test(trimmed)) {
        const bulletContent = trimmed.replace(/^[*-]\s+/, '');
        elements.push(
          <div key={`bullet-${i}`} className="flex items-start gap-2 pl-1 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0 mt-1.5 shadow-sm shadow-cyan-400/50" />
            <div className="flex-1 text-slate-200 leading-relaxed">{formatInline(bulletContent)}</div>
          </div>
        );
        i++;
        continue;
      }

      // 5. Standard paragraph
      elements.push(
        <p key={`p-${i}`} className="text-slate-200 leading-relaxed">
          {formatInline(trimmed)}
        </p>
      );
      i++;
    }

    return <div className="space-y-1.5 text-xs sm:text-[13px]">{elements}</div>;
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const presetQuestions = [
    '¿Cuál es el sismo con mayor magnitud registrado recientemente?',
    '¿Cuántos eventos hay en total?',
    '¿Hay alguna alerta de tsunami activa?',
    'Muestra los 5 sismos más recientes con su región y magnitud'
  ];

  const handleSend = async (questionText?: string) => {
    const textToSend = questionText || input.trim();
    if (!textToSend || loading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: textToSend
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!questionText) setInput('');
    setLoading(true);

    try {
      const historyPayload = messages
        .filter((m) => m.id !== 'welcome' && !m.error)
        .slice(-4)
        .map((m) => ({
          role: m.sender === 'user' ? 'user' : 'assistant',
          content: m.text,
        }));

      const data = await api.askChat(textToSend, provider, historyPayload);
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'assistant',
        text: data.reply,
        sql_query: data.sql_query,
        sql_results: data.sql_results,
        proof_of_grounding: data.proof_of_grounding,
        model_used: data.model_used,
        latency_seconds: data.latency_seconds,
        provider: data.provider
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'assistant',
        text: `⚠️ ${err.message || 'Error al procesar la consulta con el agente.'}`,
        error: true
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[650px] rounded-xl border border-slate-800 bg-slate-900/60 backdrop-blur shadow-lg overflow-hidden">
      {/* Chat Header */}
      <div className="p-4 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">
              SismoWatch
            </h3>
          </div>
        </div>

        {/* Model & Provider Switcher */}
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 p-1 rounded-lg">
          <button
            onClick={() => setProvider('local')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              provider === 'local'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            Ollama Local
          </button>
          <button
            onClick={() => setProvider('cloud')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              provider === 'cloud'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Cloud className="w-3.5 h-3.5" />
            Groq Cloud
          </button>
        </div>
      </div>

      {/* Preset Questions Bar */}
      <div className="p-2.5 border-b border-slate-800/80 bg-slate-950/40 flex items-center gap-2 overflow-x-auto text-xs">
        <span className="text-slate-500 flex items-center gap-1 whitespace-nowrap pl-1 font-semibold">
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          Sugerencias:
        </span>
        {presetQuestions.map((q, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(q)}
            disabled={loading}
            className="px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/60 whitespace-nowrap transition-colors"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Message History */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex gap-3 ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {m.sender === 'assistant' && (
              <div className="w-8 h-8 rounded-full bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                <Bot className="w-4 h-4" />
              </div>
            )}

            <div className={`max-w-xl space-y-2 ${m.sender === 'user' ? 'items-end' : 'items-start'}`}>
              <div
                className={`p-3.5 rounded-2xl text-xs sm:text-sm leading-relaxed ${
                  m.sender === 'user'
                    ? 'bg-sky-600 text-white rounded-br-none shadow-md'
                    : m.error
                    ? 'bg-rose-950/40 border border-rose-800 text-rose-200 rounded-bl-none'
                    : 'bg-slate-800/80 border border-slate-700/80 text-slate-100 rounded-bl-none shadow-sm'
                }`}
              >
                {m.sender === 'user' ? m.text : renderFormattedChatText(m.text)}
              </div>

              {/* Grounding & SQL Metadata Container */}
              {m.sql_query && (
                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-2 font-mono">
                  {/* Proof of Grounding Badge (Differentiator #2) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-1.5 text-[11px]">
                    <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
                      <ShieldCheck className="w-4 h-4" />
                      Proof of Grounding: Verificado
                    </span>
                    <span className="text-slate-400 text-[10px]">
                      {m.model_used} • {m.latency_seconds}s
                    </span>
                  </div>

                  {/* Toggle SQL viewer */}
                  <div>
                    <button
                      onClick={() => setExpandedSqlId(expandedSqlId === m.id ? null : m.id)}
                      className="flex items-center justify-between w-full text-slate-400 hover:text-sky-400 py-0.5"
                    >
                      <span className="flex items-center gap-1.5 text-[11px]">
                        <Terminal className="w-3 h-3 text-sky-400" />
                        SQL Ejecutado ({m.proof_of_grounding?.rows_retrieved ?? 0} filas)
                      </span>
                      {expandedSqlId === m.id ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {expandedSqlId === m.id && (
                      <div className="mt-2 p-2 rounded bg-slate-900 border border-slate-800 text-[11px] text-sky-300 overflow-x-auto whitespace-pre">
                        {m.sql_query}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {m.sender === 'user' && (
              <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 shrink-0">
                <UserIcon className="w-4 h-4" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-full bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
              <Bot className="w-4 h-4 animate-spin" />
            </div>
            <div className="p-3.5 rounded-2xl rounded-bl-none bg-slate-800/80 border border-slate-700/80 text-xs text-slate-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping"></span>
              Traduciendo a SQL de solo lectura y validando contra curated.v_events_chat...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="p-3 border-t border-slate-800 bg-slate-950 flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Haz una pregunta sobre los sismos (ej: ¿Cuáles fueron los sismos en California?)..."
          disabled={loading}
          className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
        />
        <button
          type="button"
          onClick={toggleVoiceInput}
          title={isListening ? "Detener dictado por voz" : "Dictar pregunta por voz (Español)"}
          className={`p-2.5 rounded-lg border transition-all flex items-center justify-center ${
            isListening
              ? 'bg-rose-500/20 border-rose-500 text-rose-400 animate-pulse'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
          }`}
        >
          {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-medium text-xs sm:text-sm flex items-center gap-1.5 transition-colors"
        >
          <Send className="w-4 h-4" />
          <span>Enviar</span>
        </button>
      </form>
    </div>
  );
};
