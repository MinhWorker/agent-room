'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Search, 
  Settings, 
  Phone, 
  Video, 
  Info, 
  Plus, 
  Smile, 
  Send,
  Bot,
  User,
  Zap,
  Code
} from 'lucide-react';

// --- Types ---
interface Message {
  id: number;
  text: string;
  sender: 'user' | 'agent';
  time: string;
}

interface Contact {
  id: string;
  name: string;
  avatar: React.ReactNode;
  active: boolean;
  unread: number;
  status: 'online' | 'offline' | 'dnd';
  subtitle: string;
}

// --- Dummy Data ---
const CONTACTS: Contact[] = [
  { id: 'agent', name: 'Agent Room (AI)', avatar: <Bot size={20} />, active: true, unread: 0, status: 'online', subtitle: 'Ready to help' },
  { id: 'general', name: 'General Chat', avatar: <User size={20} />, active: false, unread: 3, status: 'offline', subtitle: 'Alice: Let us meet...' },
  { id: 'code', name: 'Code Review', avatar: <Code size={20} />, active: false, unread: 0, status: 'online', subtitle: 'Bob: LGTM!' },
  { id: 'ideas', name: 'Ideas & Brainstorming', avatar: <Zap size={20} />, active: false, unread: 1, status: 'dnd', subtitle: 'Maybe we should...' },
];

const INITIAL_MESSAGES: Message[] = [
  { id: 1, text: 'Hello! I am your AI assistant in the Agent Room.', sender: 'agent', time: '10:00 AM' },
  { id: 2, text: 'I can help you write code, design UIs, or answer any questions you have.', sender: 'agent', time: '10:01 AM' },
  { id: 3, text: 'Hi! Can you help me design a really premium looking macOS chat app?', sender: 'user', time: '10:05 AM' },
  { id: 4, text: 'Absolutely! I will use Framer Motion for smooth animations, Lucide for crisp icons, and Tailwind CSS for that perfect frosted glass effect.', sender: 'agent', time: '10:06 AM' },
];

export default function MacOSChatRoom() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [activeContact, setActiveContact] = useState<Contact>(CONTACTS[0]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Hydration fix
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (mounted) {
      scrollToBottom();
    }
  }, [messages, isTyping, mounted]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    
    const newUserMsg: Message = { 
      id: Date.now(), 
      text: inputValue, 
      sender: 'user', 
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    };
    
    setMessages(prev => [...prev, newUserMsg]);
    setInputValue('');
    setIsTyping(true);

    // Simulate AI response
    setTimeout(() => {
      const responses = [
        "That's a great idea! Let's implement it.",
        "I'm on it. Give me a moment.",
        "Here is a refined version of what you asked for.",
        "Could you clarify one detail about that?",
      ];
      const randomResponse = responses[Math.floor(Math.random() * responses.length)];
      
      setMessages(prev => [
        ...prev, 
        { 
          id: Date.now() + 1, 
          text: randomResponse, 
          sender: 'agent', 
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        }
      ]);
      setIsTyping(false);
    }, 1500 + Math.random() * 1000);
  };

  if (!mounted) {
    return <div className="h-screen w-full bg-white dark:bg-[#1c1c1e]" />;
  }

  return (
    // Outer layout: Center window on screen if width > 1440px
    <div className="w-full max-w-[1440px] mx-auto h-screen flex overflow-hidden bg-white dark:bg-[#1a1a1c] text-gray-900 dark:text-gray-100 border-x border-gray-200/80 dark:border-[#2f2f32] shadow-xl font-sans antialiased">
      
      {/* --- LEFT SIDEBAR --- */}
      <div className="w-72 md:w-80 flex-shrink-0 flex flex-col bg-[#f5f5f7] dark:bg-[#252528] border-r border-gray-200/80 dark:border-[#2f2f32]">
        
        {/* Sidebar Header: Window Controls & Action Buttons */}
        <div className="h-16 flex items-center justify-between px-5 shrink-0">
          {/* macOS Traffic Lights */}
          <div className="flex space-x-2">
            <div className="w-3.5 h-3.5 rounded-full bg-[#ff5f56] border border-[#e0443e] shadow-sm"></div>
            <div className="w-3.5 h-3.5 rounded-full bg-[#ffbd2e] border border-[#dea123] shadow-sm"></div>
            <div className="w-3.5 h-3.5 rounded-full bg-[#27c93f] border border-[#1aab29] shadow-sm"></div>
          </div>
          
          {/* Action button */}
          <button className="p-2 text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg transition-colors">
            <Plus size={18} />
          </button>
        </div>

        {/* Search Bar - Better padding, no layout clipping */}
        <div className="px-5 pb-4 shrink-0">
          <div className="relative flex items-center bg-[#e4e4e6] dark:bg-[#1e1e21] rounded-xl px-3.5 py-2 border border-gray-200/30 dark:border-white/5 gap-2.5">
            <Search size={15} className="text-gray-400 shrink-0" />
            <input 
              type="text" 
              placeholder="Search" 
              className="w-full bg-transparent border-none text-[13.5px] text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none p-0" 
            />
          </div>
        </div>

        {/* Sidebar Contacts List - Generous vertical spacing */}
        <div className="flex-1 overflow-y-auto px-3.5 space-y-1.5 pb-4">
          {CONTACTS.map((contact) => {
            const isSelected = activeContact.id === contact.id;
            return (
              <button
                key={contact.id}
                onClick={() => setActiveContact(contact)}
                className={`w-full flex items-center px-4 py-3.5 rounded-xl text-left select-none transition-all relative gap-3
                  ${isSelected 
                    ? 'bg-[#007aff] text-white shadow-md' 
                    : 'hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300'
                  }`}
              >
                {/* Avatar with status dot */}
                <div className="relative shrink-0">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-sm
                                 ${isSelected ? 'bg-white/20 text-white' : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white'}`}>
                    {contact.avatar}
                  </div>
                  {/* Status Indicator */}
                  <span className={`absolute bottom-[-1.5px] right-[-1px] w-3 h-3 rounded-full border-2 border-white dark:border-[#252528]
                                  ${contact.status === 'online' ? 'bg-[#34c759]' : contact.status === 'dnd' ? 'bg-[#ff3b30]' : 'bg-[#8e8e93]'}`} 
                  />
                </div>
                
                {/* Contact information with clean gap */}
                <div className="flex-1 min-w-0 pr-1 py-0.5">
                  <div className="flex justify-between items-baseline mb-1 gap-2">
                    <span className={`font-semibold text-[14.5px] truncate ${isSelected ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
                      {contact.name}
                    </span>
                    <span className={`text-[11px] shrink-0 ${isSelected ? 'text-blue-100' : 'text-gray-400 dark:text-gray-500'}`}>
                      10:05 AM
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className={`text-[13px] truncate pr-2 ${isSelected ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'}`}>
                      {contact.subtitle}
                    </span>
                    {contact.unread > 0 && !isSelected && (
                      <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-[#007aff] text-[10px] font-bold text-white flex items-center justify-center shrink-0">
                        {contact.unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        
        {/* User profile section at the bottom */}
        <div className="h-16 px-5 border-t border-gray-200/80 dark:border-[#2f2f32] flex items-center justify-between bg-[#ececec]/30 dark:bg-[#1e1e20]/30 shrink-0">
          <div className="flex items-center min-w-0 mr-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-500 flex items-center justify-center text-white mr-3 shrink-0 shadow-sm">
              <User size={16} />
            </div>
            <span className="text-[14px] font-semibold text-gray-700 dark:text-gray-200 truncate">MinhWorker</span>
          </div>
          <button className="p-2 text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors shrink-0">
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* --- MAIN CHAT AREA --- */}
      <div className="flex-1 flex flex-col bg-white dark:bg-[#1e1e1e] min-w-0 h-full relative">
        
        {/* Chat Header - Higher spacing and padding */}
        <div className="h-16 border-b border-gray-200 dark:border-[#2f2f32] flex items-center justify-between px-8 bg-[#fafafa]/80 dark:bg-[#1e1e1e]/80 backdrop-blur-md shrink-0 z-20">
          <div className="flex flex-col justify-center min-w-0">
            <h2 className="text-[15px] font-bold text-gray-900 dark:text-gray-100 truncate">{activeContact.name}</h2>
            <div className="flex items-center space-x-2 mt-0.5">
              <span className={`w-2 h-2 rounded-full ${activeContact.status === 'online' ? 'bg-[#34c759]' : 'bg-[#8e8e93]'}`} />
              <span className="text-[11.5px] text-gray-500 dark:text-gray-400 font-medium">
                {activeContact.status === 'online' ? 'Active now' : 'Offline'}
              </span>
            </div>
          </div>
          
          {/* Header Action Buttons */}
          <div className="flex items-center space-x-2 shrink-0">
            <button className="p-2.5 text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors"><Phone size={17} /></button>
            <button className="p-2.5 text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors"><Video size={17} /></button>
            <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-2"></div>
            <button className="p-2.5 text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-colors"><Info size={17} /></button>
          </div>
        </div>

        {/* Message Log */}
        <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col">
          {/* Top Spacing to push messages down if screen height is very large, but start naturally */}
          <div className="flex-1" />
          
          <div className="text-center my-6 shrink-0">
            <span className="px-3 py-1.5 rounded-full bg-black/5 dark:bg-white/5 text-[10.5px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
              Today
            </span>
          </div>
          
          <div className="space-y-5 pb-6">
            <AnimatePresence initial={false}>
              {messages.map((msg, index) => {
                const isUser = msg.sender === 'user';
                const showAvatar = index === messages.length - 1 || messages[index + 1]?.sender !== msg.sender;
                
                return (
                  <motion.div 
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className={`flex items-end ${isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    {/* Bot Avatar (Only for Agent) */}
                    {!isUser && (
                      <div className={`w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white mr-3 shrink-0 ${!showAvatar ? 'invisible' : 'shadow-sm'}`}>
                        <Bot size={15} />
                      </div>
                    )}
                    
                    {/* Bubble and Timestamp Container */}
                    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[70%]`}>
                      <div 
                        className={`px-5 py-2.5 text-[14.5px] leading-relaxed shadow-sm break-words
                          ${isUser 
                            ? 'bg-[#007aff] text-white rounded-[20px] rounded-br-[4px]' 
                            : 'bg-[#f2f2f7] dark:bg-[#2c2c2e] text-gray-900 dark:text-gray-100 rounded-[20px] rounded-bl-[4px] border border-gray-200/30 dark:border-white/5'
                          }`}
                      >
                        {msg.text}
                      </div>
                      {/* Timestamp */}
                      {showAvatar && (
                        <span className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-1.5 px-2 select-none">
                          {msg.time}
                        </span>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            
            {/* Typing Indicator */}
            <AnimatePresence>
              {isTyping && (
                <motion.div 
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="flex items-end justify-start"
                >
                   <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white mr-3 shadow-sm shrink-0">
                      <Bot size={15} />
                    </div>
                    <div className="bg-[#f2f2f7] dark:bg-[#2c2c2e] px-5 py-3 rounded-[20px] rounded-bl-[4px] border border-gray-200/30 dark:border-white/5 shadow-sm flex items-center space-x-1.5 h-9">
                      <motion.div className="w-1.5 h-1.5 bg-gray-500 dark:bg-gray-400 rounded-full" animate={{ y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0 }} />
                      <motion.div className="w-1.5 h-1.5 bg-gray-500 dark:bg-gray-400 rounded-full" animate={{ y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.15 }} />
                      <motion.div className="w-1.5 h-1.5 bg-gray-500 dark:bg-gray-400 rounded-full" animate={{ y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 0.8, delay: 0.3 }} />
                    </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={messagesEndRef} className="h-1" />
          </div>
        </div>

        {/* Input area - Better height and vertical margins */}
        <div className="p-5 bg-white dark:bg-[#1e1e1e] border-t border-gray-200 dark:border-[#2f2f32] shrink-0">
          <form onSubmit={handleSend} className="relative flex items-center max-w-4xl mx-auto gap-3">
            
            {/* Plus Attachment Button */}
            <button type="button" className="p-2 text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0">
              <Plus size={22} />
            </button>
            
            {/* Message input container - Generous padding */}
            <div className="relative flex-1 flex items-center bg-[#f2f2f7] dark:bg-[#2c2c2e] rounded-full px-5 py-2.5 border border-gray-200/50 dark:border-white/5 focus-within:ring-2 focus-within:ring-blue-500/30 transition-all gap-3">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="iMessage"
                className="w-full bg-transparent border-none text-[14.5px] text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none p-0 pr-8 leading-relaxed"
              />
              {/* Emoji icon inside input */}
              <div className="absolute right-3 flex items-center">
                <button type="button" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                  <Smile size={20} />
                </button>
              </div>
            </div>
            
            {/* Send button */}
            <button
              type="submit"
              disabled={!inputValue.trim()}
              className={`p-2.5 rounded-full flex items-center justify-center transition-all shrink-0
                ${inputValue.trim() 
                  ? 'bg-[#007aff] text-white hover:bg-blue-600 shadow-md scale-100 active:scale-95' 
                  : 'bg-transparent text-gray-300 dark:text-gray-700'}`}
            >
              <Send size={18} className={inputValue.trim() ? "translate-x-[0.5px] translate-y-[-0.5px]" : ""} />
            </button>
          </form>
        </div>
        
      </div>
    </div>
  );
}
