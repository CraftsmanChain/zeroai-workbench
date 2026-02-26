import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import '../Chat.css';

interface OllamaChatProps {
  models: string[];
}

const OllamaChat: React.FC<OllamaChatProps> = ({ models }) => {
  const [messages, setMessages] = useState<{ role: string, content: string }[]>([]);
  const [input, setInput] = useState('');
  const [selectedModel, setSelectedModel] = useState(models[0] || '');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeRequestIdRef = useRef<string | null>(null);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Setup IPC listener for streaming
  useEffect(() => {
    if (!window.api) return;

    const unsubscribe = window.api.onOllamaReply((chunk: any) => {
      const requestId = chunk?.requestId;
      if (!requestId || requestId !== activeRequestIdRef.current) return;

      if (chunk?.error) {
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg?.role === 'assistant') {
            return [...prev.slice(0, -1), { ...lastMsg, content: `${lastMsg.content}\n\n错误: ${chunk.error}`.trim() }];
          }
          return [...prev, { role: 'assistant', content: `错误: ${chunk.error}` }];
        });
        setIsTyping(false);
        activeRequestIdRef.current = null;
        return;
      }

      if (chunk?.done) {
        setIsTyping(false);
        activeRequestIdRef.current = null;
        return;
      }

      const delta = chunk?.message?.content;
      if (!delta) return;

      setMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          return [...prev.slice(0, -1), { ...lastMsg, content: lastMsg.content + delta }];
        }
        return [...prev, { role: 'assistant', content: delta }];
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const sendMessage = async () => {
    if (!input.trim()) return;
    
    const userMsg = { role: 'user', content: input };
    const newMessages = [...messages, userMsg];
    
    setMessages(newMessages);
    setInput('');
    setIsTyping(true);

    // Add a placeholder for AI response
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    activeRequestIdRef.current = requestId;

    if (!window.api) {
        // Fallback for browser dev mode
        setTimeout(() => {
            setMessages(prev => {
                const last = prev[prev.length - 1];
                return [...prev.slice(0, -1), { ...last, content: '演示模式: 无法连接到本地模型。' }];
            });
            setIsTyping(false);
        }, 1000);
        return;
    }

    try {
      const res = await window.api.chatWithOllamaStream(requestId, selectedModel, newMessages);
      if (!res || res.status !== 'ok') {
        setMessages(prev => {
            const last = prev[prev.length - 1];
            return [...prev.slice(0, -1), { ...last, content: `错误: ${res?.message || '未知错误'}` }];
        });
        setIsTyping(false);
        activeRequestIdRef.current = null;
      }
    } catch (err: any) {
      setMessages(prev => {
          const last = prev[prev.length - 1];
          return [...prev.slice(0, -1), { ...last, content: `通信失败: ${err.message}` }];
      });
      setIsTyping(false);
      activeRequestIdRef.current = null;
    }
  };

  const stopGenerating = async () => {
    if (!window.api) return;
    const requestId = activeRequestIdRef.current;
    if (!requestId) return;
    try {
      await window.api.abortOllamaStream(requestId);
    } finally {
      activeRequestIdRef.current = null;
      setIsTyping(false);
    }
  };

  return (
    <div className="chat-interface">
      <div className="chat-header">
        <select aria-label="选择模型" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
          {models.length > 0 ? models.map(m => <option key={m} value={m}>{m}</option>) : <option>无可用模型</option>}
        </select>
        <div style={{display: 'flex', gap: '10px', alignItems: 'center'}}>
          <span>本地运行</span>
          {isTyping && (
            <button onClick={stopGenerating} style={{padding: '6px 10px', borderRadius: '6px', border: '1px solid #565869', background: '#40414f', color: '#fff'}}>
              停止
            </button>
          )}
        </div>
      </div>
      
      <div className="messages">
        {messages.map((m, i) => (
          <div key={i} className={`message-row ${m.role}`}>
            <div className={`avatar ${m.role}`}>{m.role === 'user' ? 'U' : 'AI'}</div>
            <div className={`message-bubble ${m.role}`}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ node, inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || '');
                    return !inline && match ? (
                      <SyntaxHighlighter
                        style={vscDarkPlus}
                        language={match[1]}
                        PreTag="div"
                        {...props}
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    ) : (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  }
                }}
              >
                {m.content}
              </ReactMarkdown>
            </div>
          </div>
        ))}
        {messages.length === 0 && (
            <div className="empty-state">
                <h2>有什么可以帮您？</h2>
                <p>选择一个模型开始对话</p>
            </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <textarea 
          value={input} 
          onChange={(e) => setInput(e.target.value)} 
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder="输入消息... (Shift+Enter 换行)" 
          rows={1}
        />
        <button onClick={sendMessage} disabled={isTyping || !input.trim()}>
            {isTyping ? '...' : '发送'}
        </button>
      </div>
    </div>
  );
};

export default OllamaChat;
