


import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Paperclip, X, RefreshCw, Wifi, WifiOff, Users, Bell, CheckCheck, Check, Clock, AlertCircle } from 'lucide-react';
import * as signalR from '@microsoft/signalr';
import { useAuth } from '../Pages/AuthPage';

const ChatApp = () => {
  const { user, logout, isLoading: authLoading } = useAuth();
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [message, setMessage] = useState('');
  const [file, setFile] = useState(null);
  const [connectionError, setConnectionError] = useState(null);
  const [connectionState, setConnectionState] = useState('Disconnected');
  const [userPhotos, setUserPhotos] = useState({});
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [debugLogs, setDebugLogs] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [liveEvents, setLiveEvents] = useState([]);

  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const messageIdsRef = useRef(new Set());
  const hubConnectionRef = useRef(null);
  const pendingMessagesRef = useRef({});
  const selectedUserRef = useRef(null); // Add ref to track selected user

  const addDebugLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs(prev => [...prev.slice(-50), { timestamp, message, type }]);
    console.log(`[${timestamp}] ${message}`);
  }, []);

  const addLiveEvent = useCallback((event, type = 'message') => {
    const id = `event-${Date.now()}-${Math.random()}`;
    setLiveEvents(prev => [...prev.slice(-5), { id, event, type, timestamp: new Date() }]);
    setTimeout(() => {
      setLiveEvents(prev => prev.filter(e => e.id !== id));
    }, 4000);
  }, []);

  const apiFetch = useCallback(async (url, options = {}, retryCount = 0) => {
    const maxRetries = 2;
    addDebugLog(`API Request: ${options.method || 'GET'} ${url}`, 'info');

    // Get fresh token from localStorage
    const accessToken = localStorage.getItem('accessToken') || user?.accessToken;

    const config = {
      ...options,
      headers: {
        'Content-Type': options.body instanceof FormData ? undefined : 'application/json',
        ...options.headers,
        Authorization: `Bearer ${accessToken}`,
      },
      mode: 'cors',
      credentials: 'omit',
    };

    if (options.body instanceof FormData) {
      delete config.headers['Content-Type'];
    }

    try {
      const response = await fetch(url, config);
      addDebugLog(`Response Status: ${response.status}`, response.ok ? 'success' : 'error');

      if (response.status === 429) {
        if (retryCount < maxRetries) {
          const waitTime = Math.min(2000 * Math.pow(2, retryCount), 10000);
          addDebugLog(`Rate limited. Retrying in ${waitTime / 1000}s`, 'warning');
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return apiFetch(url, options, retryCount + 1);
        }
        throw new Error('Rate limit exceeded');
      }

      if (response.ok) {
        setConnectionError(null);
        return response;
      }

      if (response.status === 401 && retryCount === 0) {
        addDebugLog('Token expired, logging out...', 'error');
        logout();
        throw new Error('Authentication expired');
      }

      const errorText = await response.text().catch(() => '');
      throw new Error(`API Error ${response.status}: ${errorText}`);
    } catch (error) {
      if (error.name === 'TypeError' || error.message.includes('Failed to fetch')) {
        addDebugLog(`Network error: ${error.message}`, 'error');
        setConnectionError('Network error. Check connection.');
        throw new Error('Network error');
      }
      throw error;
    }
  }, [user?.accessToken, logout, addDebugLog]);

  const setupSignalRConnection = useCallback(async () => {
    const accessToken = localStorage.getItem('accessToken') || user?.accessToken;
    if (!accessToken || hubConnectionRef.current) return;
    
    addDebugLog('Setting up SignalR connection...', 'info');

    const connection = new signalR.HubConnectionBuilder()
      .withUrl('https://physiocareapp.runasp.net/chathub', {
        accessTokenFactory: () => localStorage.getItem('accessToken') || user?.accessToken || '',
        transport: signalR.HttpTransportType.WebSockets | signalR.HttpTransportType.ServerSentEvents | signalR.HttpTransportType.LongPolling,
        skipNegotiation: false,
        withCredentials: false
      })
      .withAutomaticReconnect({
        nextRetryDelayInMilliseconds: (retryContext) => {
          if (retryContext.elapsedMilliseconds < 60000) {
            return Math.min(1000 * Math.pow(2, retryContext.previousRetryCount), 10000);
          }
          return null;
        }
      })
      .configureLogging(signalR.LogLevel.Information)
      .build();

    // RECEIVING MESSAGES - Backend currently sends: SendAsync("ReceiveMessage", senderName, messageText, senderId)
    connection.on('ReceiveMessage', (param1, param2, param3, param4, param5) => {
      // Try to parse different backend formats
      let senderId, recipientId, messageText, date, fileName, senderName;
      
      // Format 1: Backend sends (senderName, messageText, senderId) - Current backend format
      if (typeof param1 === 'string' && typeof param2 === 'string' && param3 && !param4) {
        senderName = param1;
        messageText = param2;
        senderId = param3;
        recipientId = user.id; // Use current user as recipient
        date = new Date().toISOString();
        fileName = null;
        addDebugLog(`📨 Received OLD format: senderName=${senderName}, text="${messageText}", senderId=${senderId}`, 'info');
      }
      // Format 2: Backend sends (senderId, recipientId, messageText, date, fileName) - Ideal format
      else if (param1 && param2 && typeof param3 === 'string') {
        senderId = param1;
        recipientId = param2;
        messageText = param3;
        date = param4 || new Date().toISOString();
        fileName = param5 || null;
        senderName = users.find(u => String(u.id) === String(senderId))?.name || 'Unknown';
        addDebugLog(`📨 Received NEW format: senderId=${senderId}, recipientId=${recipientId}, text="${messageText}"`, 'info');
      }
      // Fallback
      else {
        addDebugLog(`⚠️ Unknown message format received: ${JSON.stringify([param1, param2, param3, param4, param5])}`, 'warning');
        return;
      }
      
      const recipientName = users.find(u => String(u.id) === String(recipientId))?.name || 'Unknown';
      
      addLiveEvent(`📨 ${senderName} → ${recipientName}: ${messageText?.substring(0, 30) || 'File'}`, 'message');
      addDebugLog(`📨 Processed message from ${senderName} (${senderId}) to ${recipientName} (${recipientId})`, 'success');

      const newMessage = {
        id: `signalr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        senderId: String(senderId),
        recipientId: String(recipientId),
        text: messageText || '',
        date: date || new Date().toISOString(),
        file: fileName || null,
        isOptimistic: false,
        isDelivered: true,
        isUnread: true
      };

      const isFromMe = String(senderId) === String(user.id);
      const isForMe = String(recipientId) === String(user.id);
      const otherUserId = isFromMe ? String(recipientId) : String(senderId);
      
      // Use ref to get current selected user
      const currentSelectedUser = selectedUserRef.current;
      const isCurrentConversation = currentSelectedUser && (
        String(currentSelectedUser.id) === otherUserId || 
        String(currentSelectedUser.id) === String(senderId) || 
        String(currentSelectedUser.id) === String(recipientId)
      );

      addDebugLog(`Message routing: isFromMe=${isFromMe}, isForMe=${isForMe}, otherUserId=${otherUserId}, selectedUserId=${currentSelectedUser?.id}, isCurrentConversation=${isCurrentConversation}`, 'info');

      // INSTANT MESSAGE DELIVERY TO UI
      if (isCurrentConversation) {
        addDebugLog(`💬 Delivering message to current conversation UI`, 'success');
        setMessages(prev => {
          // Remove matching optimistic message (same sender, recipient, text, and file)
          const withoutOptimistic = prev.filter(m => {
            if (!m.isOptimistic) return true;
            const isSameMessage = String(m.senderId) === String(newMessage.senderId) &&
              String(m.recipientId) === String(newMessage.recipientId) &&
              (m.text || '').trim() === (newMessage.text || '').trim() &&
              (m.file || null) === (newMessage.file || null);
            if (isSameMessage) {
              addDebugLog(`🔄 Replacing optimistic message with real SignalR message`, 'success');
            }
            return !isSameMessage;
          });
          
          // Check if message already exists (prevent duplicates)
          const messageExists = withoutOptimistic.some(m => 
            String(m.senderId) === String(newMessage.senderId) &&
            String(m.recipientId) === String(newMessage.recipientId) &&
            (m.text || '').trim() === (newMessage.text || '').trim() &&
            Math.abs(new Date(m.date) - new Date(newMessage.date)) < 10000 // Within 10 seconds
          );

          if (messageExists) {
            addDebugLog(`⚠️ Duplicate message detected, skipping`, 'warning');
            return withoutOptimistic;
          }

          const updated = [...withoutOptimistic, { ...newMessage, isUnread: false }].sort((a, b) =>
            new Date(a.date) - new Date(b.date)
          );
          
          addDebugLog(`✅ Message added to UI. Total messages: ${updated.length}`, 'success');
          return updated;
        });

        // Immediate scroll to bottom
        setTimeout(() => {
          if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
          }
        }, 0);

        addDebugLog(`✅ Message instantly delivered to UI`, 'success');
      }
      // If I sent this message but not in current conversation, store it
      else if (isFromMe) {
        const recipientIdStr = String(recipientId);
        addDebugLog(`📤 Storing my message for recipient ${recipientIdStr}`, 'info');
        
        pendingMessagesRef.current = {
          ...pendingMessagesRef.current,
          [recipientIdStr]: [
            ...(pendingMessagesRef.current[recipientIdStr] || []),
            newMessage
          ]
        };
      }
      // Store incoming messages from others
      else if (isForMe && !isFromMe) {
        const senderIdStr = String(senderId);
        addDebugLog(`📬 Storing incoming message from user ${senderIdStr}`, 'info');
        
        setUnreadCounts(prev => ({
          ...prev,
          [senderIdStr]: (prev[senderIdStr] || 0) + 1
        }));

        pendingMessagesRef.current = {
          ...pendingMessagesRef.current,
          [senderIdStr]: [
            ...(pendingMessagesRef.current[senderIdStr] || []),
            newMessage
          ]
        };

        const sender = users.find(u => String(u.id) === senderIdStr);
        if (sender) {
          setNotifications(prev => [...prev, {
            id: newMessage.id,
            senderName: sender.name,
            message: messageText || (fileName ? 'Sent a file' : 'Sent a message'),
            timestamp: new Date().toISOString()
          }]);
        }

        addDebugLog(`📬 Message stored for user ${senderIdStr}`, 'info');
      }
    });

    // USER STATUS EVENTS
    connection.on('UserStatusChanged', (userId, isOnline) => {
      const userName = users.find(u => String(u.id) === String(userId))?.name || `User ${userId}`;
      addLiveEvent(`👤 ${userName} is now ${isOnline ? 'ONLINE' : 'OFFLINE'}`, 'status');
      addDebugLog(`👤 User ${userName} (${userId}) status changed: ${isOnline ? 'ONLINE' : 'OFFLINE'}`, 'info');
      
      setUsers(prev =>
        prev.map(u =>
          String(u.id) === String(userId)
            ? { ...u, lastActive: isOnline ? 'online' : 'offline' }
            : u
        )
      );
    });

    connection.on('UserStatusList', (statusList) => {
      addLiveEvent(`📋 Received status for ${statusList.length} users`, 'status');
      addDebugLog(`📋 Received status for ${statusList.length} users`, 'info');
      
      setUsers(prev =>
        prev.map(u => {
          const status = statusList.find(s => String(s.userId) === String(u.id));
          return status ? { ...u, lastActive: status.isOnline ? 'online' : 'offline' } : u;
        })
      );
    });

    connection.onreconnecting(() => {
      addLiveEvent('⚠️ Connection lost, reconnecting...', 'error');
      addDebugLog('SignalR reconnecting...', 'warning');
      setConnectionState('Reconnecting');
    });

    connection.onreconnected(async () => {
      addLiveEvent('✅ Reconnected successfully', 'success');
      addDebugLog('✅ SignalR reconnected', 'success');
      setConnectionState('Connected');
      addDebugLog('✅ Connection restored - status managed by hub', 'success');
      fetchUserStatuses();
    });

    connection.onclose(() => {
      addLiveEvent('❌ Connection closed', 'error');
      addDebugLog('SignalR connection closed', 'error');
      setConnectionState('Disconnected');
    });

    try {
      await connection.start();
      hubConnectionRef.current = connection;
      setConnectionState('Connected');
      addLiveEvent('✅ Connected to chat server', 'success');
      addDebugLog('✅ SignalR connected successfully', 'success');
      addDebugLog('✅ User connection registered with hub automatically', 'success');

      setTimeout(() => {
        fetchUserStatuses();
      }, 1000);

    } catch (err) {
      addLiveEvent(`❌ Connection failed: ${err.message}`, 'error');
      addDebugLog(`❌ SignalR connection failed: ${err.message}`, 'error');
      setConnectionError('Real-time connection failed. Messages will be delayed.');
      setConnectionState('Disconnected');
    }
  }, [user?.accessToken, user?.id, addDebugLog, users, selectedUser, addLiveEvent]);

  const fetchUserStatuses = async () => {
    const accessToken = localStorage.getItem('accessToken') || user?.accessToken;
    if (!accessToken || users.length === 0) return;

    try {
      addDebugLog('Fetching user statuses via API...', 'info');
      const response = await apiFetch(
        'https://physiocareapp.runasp.net/api/v1/Chat/get-online-users'
      );

      if (response.ok) {
        const onlineUserIds = await response.json();
        addLiveEvent(`🟢 ${onlineUserIds.length} users online`, 'status');
        addDebugLog(`✅ Got ${onlineUserIds.length} online users from API: ${JSON.stringify(onlineUserIds)}`, 'success');

        setUsers(prev =>
          prev.map(u => {
            const isOnline = onlineUserIds.includes(String(u.id)) || onlineUserIds.includes(Number(u.id)) || onlineUserIds.some(id => String(id) === String(u.id));
            addDebugLog(`User ${u.name} (${u.id}): ${isOnline ? 'ONLINE' : 'OFFLINE'}`, 'info');
            return {
              ...u,
              lastActive: isOnline ? 'online' : 'offline'
            };
          })
        );

        // Update selected user status
        if (selectedUser) {
          const isSelectedOnline = onlineUserIds.includes(String(selectedUser.id)) || onlineUserIds.includes(Number(selectedUser.id)) || onlineUserIds.some(id => String(id) === String(selectedUser.id));
          setSelectedUser(prev => prev ? { ...prev, lastActive: isSelectedOnline ? 'online' : 'offline' } : null);
        }
      }
    } catch (err) {
      addDebugLog(`Failed to fetch user statuses: ${err.message}`, 'error');
    }
  };

  const capitalizeRole = (role) => role?.charAt(0).toUpperCase() + role?.slice(1).toLowerCase() || 'User';

  const generateInitialAvatar = (name, role) => {
    const initials = name?.split(' ').map(word => word.charAt(0).toUpperCase()).join('').substring(0, 2) || 'U';
    const colors = {
      doctor: { bg: '#28a745', text: '#FFFFFF' },
      nurse: { bg: '#007bff', text: '#FFFFFF' },
      laboratory: { bg: '#fd7e14', text: '#FFFFFF' },
      patient: { bg: '#6f42c1', text: '#FFFFFF' },
      default: { bg: '#6c757d', text: '#FFFFFF' }
    };
    const colorScheme = colors[role?.toLowerCase()] || colors.default;

    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = colorScheme.bg;
    ctx.beginPath();
    ctx.arc(40, 40, 40, 0, 2 * Math.PI);
    ctx.fill();

    ctx.fillStyle = colorScheme.text;
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, 40, 40);

    return canvas.toDataURL();
  };

  const scrollToBottom = useCallback((behavior = 'auto') => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior, block: 'end' });
    }
  }, []);

  const fetchUserPhoto = async (fileName, role, userId) => {
    const userInfo = users.find(u => String(u.id) === String(userId)) || { name: 'User', role: role || 'user' };
    const initialAvatar = generateInitialAvatar(userInfo.name, userInfo.role);
    setUserPhotos(prev => ({ ...prev, [String(userId)]: initialAvatar }));

    const accessToken = localStorage.getItem('accessToken') || user?.accessToken;
    if (!fileName || !accessToken) return;

    const rolePath = capitalizeRole(role);
    try {
      const url = `https://physiocareapp.runasp.net/api/v1/Upload/image?filename=${encodeURIComponent(fileName)}&path=Actors%2F${rolePath}`;
      const res = await apiFetch(url);
      if (res.ok) {
        const blob = await res.blob();
        const imgUrl = URL.createObjectURL(blob);
        setUserPhotos(prev => ({ ...prev, [String(userId)]: imgUrl }));
      }
    } catch (err) {
      addDebugLog(`Using initial avatar for user ${userId}`, 'info');
    }
  };

  const fetchChatUsers = async () => {
    const accessToken = localStorage.getItem('accessToken') || user?.accessToken;
    if (!accessToken || !user?.id) return;

    const role = (user.role || user.Role || 'patient').toLowerCase();
    const rolesToFetch = role === 'patient' ? ['doctor', 'nurse', 'laboratory'] : ['patient'];

    try {
      addDebugLog(`Fetching users for roles: ${rolesToFetch.join(', ')}`, 'info');

      const rolePromises = rolesToFetch.map(async r => {
        const res = await apiFetch(
          `https://physiocareapp.runasp.net/api/v1/Admins/get-all-basic-info-users-by-role?role=${r}`
        );
        if (!res.ok) return [];
        const data = await res.json().catch(() => []);
        return Array.isArray(data) ? data.map(u => ({ ...u, role: r })) : [];
      });

      const allUsers = (await Promise.all(rolePromises)).flat();

      const filteredUsers = allUsers.filter(u => {
        const userId = String(u.userId || u.id).trim();
        return userId && userId !== String(user.id).trim();
      });

      const mapped = filteredUsers.map(u => ({
        id: u.userId || u.id,
        name: u.fullName || u.userName || `${capitalizeRole(u.role)} User`,
        role: u.role,
        fileName: u.fileName || null,
        lastActive: u.lastActive || 'offline',
      }));

      const uniqueUsers = mapped.reduce((acc, user) => {
        if (!acc.find(u => String(u.id) === String(user.id))) {
          acc.push(user);
        }
        return acc;
      }, []);

      addDebugLog(`✅ Loaded ${uniqueUsers.length} users`, 'success');
      setUsers(uniqueUsers);

      uniqueUsers.forEach(u => {
        if (u.fileName) {
          fetchUserPhoto(u.fileName, u.role, u.id);
        } else {
          const avatar = generateInitialAvatar(u.name, u.role);
          setUserPhotos(prev => ({ ...prev, [String(u.id)]: avatar }));
        }
      });
    } catch (err) {
      addDebugLog(`Failed to fetch users: ${err.message}`, 'error');
    }
  };

  const fetchMessages = async (userId) => {
    const accessToken = localStorage.getItem('accessToken') || user?.accessToken;
    if (!userId || !accessToken) return;

    setIsLoadingMessages(true);

    try {
      const response = await apiFetch(
        `https://physiocareapp.runasp.net/api/v1/Message/get-all-messages-by-sender-id-and-recipient-id?senderId=${encodeURIComponent(user.id)}&recipientId=${encodeURIComponent(userId)}`
      );

      if (!response.ok) throw new Error('Failed to fetch messages');

      const data = await response.json();
      const messagesArray = Array.isArray(data) ? data : [];

      messageIdsRef.current.clear();

      const mapped = messagesArray.map(msg => ({
        id: msg.id,
        text: msg.messageText || msg.text || '',
        senderId: String(msg.senderId || ''),
        recipientId: String(msg.recipientId || ''),
        date: msg.date || new Date().toISOString(),
        file: msg.fileName || msg.file || null,
        isOptimistic: false,
        isDelivered: true,
        isUnread: false
      }));

      const sorted = mapped.sort((a, b) => new Date(a.date) - new Date(b.date));

      const userIdStr = String(userId);
      const pendingMessages = pendingMessagesRef.current[userIdStr] || [];

      if (pendingMessages.length > 0) {
        addDebugLog(`Found ${pendingMessages.length} pending messages for user ${userIdStr}`, 'info');

        const allMessages = [...sorted, ...pendingMessages].sort((a, b) =>
          new Date(a.date) - new Date(b.date)
        );

        setMessages(allMessages);

        const newPending = { ...pendingMessagesRef.current };
        delete newPending[userIdStr];
        pendingMessagesRef.current = newPending;

        setUnreadCounts(prev => {
          const newCounts = { ...prev };
          delete newCounts[userIdStr];
          return newCounts;
        });
      } else {
        setMessages(sorted);
      }

      addDebugLog(`✅ Loaded ${sorted.length} messages`, 'success');
      setTimeout(() => scrollToBottom('auto'), 100);
    } catch (err) {
      addDebugLog(`Failed to fetch messages: ${err.message}`, 'error');
      setMessages([]);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const handleSendMessage = async () => {
    if ((!message.trim() && !file) || !selectedUser) return;

    const messageToSend = message.trim();
    const fileToSend = file;
    const currentSelectedUser = selectedUser;

    // Clear input immediately
    setMessage('');
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const optimisticMessage = {
      id: optimisticId,
      senderId: String(user.id),
      recipientId: String(currentSelectedUser.id),
      text: messageToSend,
      date: new Date().toISOString(),
      file: fileToSend ? fileToSend.name : null,
      isOptimistic: true,
      isDelivered: false,
      isUnread: false
    };

    // Show message instantly in UI
    setMessages(prev => [...prev, optimisticMessage]);
    requestAnimationFrame(() => scrollToBottom('auto'));
    addDebugLog(`📤 Optimistic message shown (ID: ${optimisticId})`, 'info');

    // Send to server in background
    (async () => {
      try {
        const formData = new FormData();
        formData.append('SenderId', String(user.id));
        formData.append('RecipientId', String(currentSelectedUser.id));
        formData.append('Date', new Date().toISOString());
        formData.append('MessageText', messageToSend || '');
        formData.append('UserName', user.name || user.userName || user.email?.split('@')[0] || 'User');

        if (fileToSend) {
          formData.append('ImageFile', fileToSend);
        }

        addDebugLog(`Sending message to ${currentSelectedUser.name}`, 'info');

        const response = await apiFetch(
          'https://physiocareapp.runasp.net/api/v1/Chat/sendmessage',
          { method: 'POST', body: formData }
        );

        if (!response.ok) {
          throw new Error(`Failed to send (${response.status})`);
        }

        addLiveEvent(`✅ Message sent to ${currentSelectedUser.name}`, 'success');
        addDebugLog('✅ Message sent successfully to server', 'success');

        // Convert optimistic message to delivered after 1 second
        // (in case SignalR doesn't send it back to sender)
        setTimeout(() => {
          setMessages(prev =>
            prev.map(m =>
              m.id === optimisticId ? { 
                ...m, 
                isOptimistic: false, 
                isDelivered: true,
                id: `delivered-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
              } : m
            )
          );
          addDebugLog('✅ Optimistic message converted to delivered', 'success');
        }, 1000);

      } catch (err) {
        addLiveEvent(`❌ Failed to send message`, 'error');
        addDebugLog(`❌ Failed to send: ${err.message}`, 'error');

        // Mark message as failed but keep it in UI with retry option
        setMessages(prev =>
          prev.map(m =>
            m.id === optimisticId ? { ...m, isFailed: true, isOptimistic: false } : m
          )
        );
      }
    })();
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.size > 5 * 1024 * 1024) {
        alert('File size must be less than 5MB');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      setFile(selectedFile);
    }
  };

  const handleRemoveFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatMessageTime = (date) => {
    const messageDate = new Date(date);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const isToday = messageDate.toDateString() === today.toDateString();
    const isYesterday = messageDate.toDateString() === yesterday.toDateString();

    if (isToday) {
      return messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (isYesterday) {
      return 'Yesterday ' + messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      return messageDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
        messageDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  };

  const handleUserClick = (clickedUser) => {
    if (selectedUser?.id === clickedUser.id) return;

    addDebugLog(`👤 Switching to conversation with ${clickedUser.name} (${clickedUser.id})`, 'info');
    
    // Update both state and ref
    setSelectedUser(clickedUser);
    selectedUserRef.current = clickedUser; // Keep ref in sync
    
    setMessages([]);
    messageIdsRef.current.clear();

    const userIdStr = String(clickedUser.id);
    setUnreadCounts(prev => {
      const newCounts = { ...prev };
      delete newCounts[userIdStr];
      return newCounts;
    });

    fetchMessages(clickedUser.id);
  };

  const handleNotificationClick = (notification) => {
    const sender = users.find(u => u.name === notification.senderName);
    if (sender) {
      handleUserClick(sender);
    }
    setNotifications(prev => prev.filter(n => n.id !== notification.id));
  };

  useEffect(() => {
    if (user?.id && (localStorage.getItem('accessToken') || user?.accessToken)) {
      fetchChatUsers();
      setupSignalRConnection();

      const statusInterval = setInterval(() => {
        fetchUserStatuses();
      }, 15000);

      const initialStatusTimeout = setTimeout(() => {
        fetchUserStatuses();
      }, 2000);

      const handleBeforeUnload = async () => {
        addDebugLog('Browser closing - SignalR will disconnect automatically', 'info');
      };

      const handleVisibilityChange = () => {
        if (document.hidden) {
          addDebugLog('Tab hidden - connection maintained', 'info');
        } else {
          addDebugLog('Tab visible - checking connection', 'info');
          fetchUserStatuses();
        }
      };

      window.addEventListener('beforeunload', handleBeforeUnload);
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        clearInterval(statusInterval);
        clearTimeout(initialStatusTimeout);
        window.removeEventListener('beforeunload', handleBeforeUnload);
        document.removeEventListener('visibilitychange', handleVisibilityChange);

        if (hubConnectionRef.current && hubConnectionRef.current.state === 'Connected') {
          addDebugLog('Component unmounting - closing SignalR connection', 'info');
          hubConnectionRef.current.stop().then(() => {
            hubConnectionRef.current = null;
          }).catch(err => {
            console.error('Error stopping connection:', err);
          });
        }
      };
    }
  }, [user?.id, user?.accessToken]);

  // Sync selectedUser state with ref whenever it changes
  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (notifications.length > 0) {
        setNotifications(prev => prev.slice(1));
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [notifications]);

  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems:'center', justifyContent: 'center', height: '100vh', fontFamily: 'Arial, sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <RefreshCw className="animate-spin" size={48} style={{ margin: '0 auto 16px' }} />
          <p style={{ fontSize: '18px', color: '#666' }}>Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Arial, sans-serif' }}>
        <div style={{ textAlign: 'center', padding: '32px', backgroundColor: '#f8f9fa', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
          <AlertCircle size={48} style={{ color: '#dc3545', margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Authentication Required</h2>
          <p style={{ color: '#666' }}>Please log in to access the chat.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'Arial, sans-serif', backgroundColor: '#f0f2f5' }}>
      {/* Sidebar */}
      <div style={{ width: '320px', backgroundColor: '#ffffff', borderRight: '1px solid #e0e0e0', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '16px', borderBottom: '1px solid #e0e0e0', backgroundColor: '#128C7E' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#ffffff', margin: 0 }}>Messages</h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {connectionState === 'Connected' ? (
                <Wifi size={20} style={{ color: '#25D366' }} />
              ) : connectionState === 'Reconnecting' ? (
                <RefreshCw size={20} className="animate-spin" style={{ color: '#FFA500' }} />
              ) : (
                <WifiOff size={20} style={{ color: '#dc3545' }} />
              )}
              <button
                onClick={() => setDebugMode(!debugMode)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#ffffff',
                  cursor: 'pointer',
                  padding: '4px',
                  fontSize: '12px'
                }}
              >
                {debugMode ? '🐛' : '⚙️'}
              </button>
            </div>
          </div>
          <div style={{ fontSize: '12px', color: '#ffffff', opacity: 0.9 }}>
            {connectionState} • {users.length} contacts
          </div>
        </div>

        {/* Connection Error */}
        {connectionError && (
          <div style={{ padding: '12px', backgroundColor: '#fff3cd', borderBottom: '1px solid #ffc107' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertCircle size={16} style={{ color: '#856404' }} />
              <span style={{ fontSize: '12px', color: '#856404' }}>{connectionError}</span>
            </div>
          </div>
        )}

        {/* Live Events */}
        {liveEvents.length > 0 && (
          <div style={{ padding: '8px', backgroundColor: '#e7f3ff', borderBottom: '1px solid #bee5eb', maxHeight: '120px', overflowY: 'auto' }}>
            {liveEvents.map(event => (
              <div key={event.id} style={{ fontSize: '11px', color: '#004085', padding: '4px 8px', marginBottom: '4px', backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: '4px' }}>
                {event.event}
              </div>
            ))}
          </div>
        )}

        {/* Notifications */}
        {notifications.length > 0 && (
          <div style={{ padding: '8px', backgroundColor: '#d4edda', borderBottom: '1px solid #c3e6cb' }}>
            {notifications.map(notif => (
              <div
                key={notif.id}
                onClick={() => handleNotificationClick(notif)}
                style={{
                  padding: '8px',
                  marginBottom: '4px',
                  backgroundColor: '#ffffff',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <Bell size={14} style={{ color: '#155724' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 'bold', color: '#155724' }}>{notif.senderName}</div>
                  <div style={{ color: '#666' }}>{notif.message}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Users List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {users.map(u => {
            const unreadCount = unreadCounts[String(u.id)] || 0;
            return (
              <div
                key={u.id}
                onClick={() => handleUserClick(u)}
                style={{
                  padding: '12px 16px',
                  cursor: 'pointer',
                  backgroundColor: selectedUser?.id === u.id ? '#f0f2f5' : '#ffffff',
                  borderBottom: '1px solid #e0e0e0',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = selectedUser?.id === u.id ? '#f0f2f5' : '#ffffff'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ position: 'relative' }}>
                    <img
                      src={userPhotos[String(u.id)] || generateInitialAvatar(u.name, u.role)}
                      alt={u.name}
                      style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover' }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '0',
                        right: '0',
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        backgroundColor: u.lastActive === 'online' ? '#25D366' : '#95a5a6',
                        border: '2px solid #ffffff'
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{ fontWeight: '600', fontSize: '15px', color: '#000000' }}>{u.name}</span>
                      {unreadCount > 0 && (
                        <div style={{
                          backgroundColor: '#25D366',
                          color: '#ffffff',
                          borderRadius: '12px',
                          padding: '2px 8px',
                          fontSize: '11px',
                          fontWeight: 'bold',
                          minWidth: '20px',
                          textAlign: 'center'
                        }}>
                          {unreadCount}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: '12px', color: '#667781' }}>
                      {capitalizeRole(u.role)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#efeae2' }}>
        {selectedUser ? (
          <>
            {/* Chat Header */}
            <div style={{ padding: '12px 16px', backgroundColor: '#f0f2f5', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img
                src={userPhotos[String(selectedUser.id)] || generateInitialAvatar(selectedUser.name, selectedUser.role)}
                alt={selectedUser.name}
                style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: '600', fontSize: '16px', color: '#000000' }}>{selectedUser.name}</div>
                <div style={{ fontSize: '13px', color: '#667781' }}>
                  {selectedUser.lastActive === 'online' ? 'Online' : 'Offline'} • {capitalizeRole(selectedUser.role)}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', backgroundImage: 'url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVR42mN49+7dfwYiAOOoQvoqBABG6xx8R3yLcAAAAABJRU5ErkJggg==)', backgroundRepeat: 'repeat' }}>
              {isLoadingMessages ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '32px' }}>
                  <RefreshCw className="animate-spin" size={32} style={{ color: '#667781' }} />
                </div>
              ) : messages.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px', color: '#667781' }}>
                  <Users size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                  <p>No messages yet. Start the conversation!</p>
                </div>
              ) : (
                messages.map((msg, index) => {
                  const isFromMe = String(msg.senderId) === String(user.id);
                  const showAvatar = index === 0 || String(messages[index - 1].senderId) !== String(msg.senderId);

                  return (
                    <div
                      key={msg.id}
                      style={{
                        display: 'flex',
                        justifyContent: isFromMe ? 'flex-end' : 'flex-start',
                        marginBottom: '8px',
                        alignItems: 'flex-end',
                        gap: '8px'
                      }}
                    >
                      {!isFromMe && (
                        <img
                          src={userPhotos[String(selectedUser.id)] || generateInitialAvatar(selectedUser.name, selectedUser.role)}
                          alt={selectedUser.name}
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            objectFit: 'cover',
                            visibility: showAvatar ? 'visible' : 'hidden'
                          }}
                        />
                      )}
                      <div
                        style={{
                          maxWidth: '65%',
                          padding: '8px 12px',
                          borderRadius: '8px',
                          backgroundColor: isFromMe ? '#d9fdd3' : '#ffffff',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                          position: 'relative',
                          opacity: msg.isOptimistic ? 0.7 : 1
                        }}
                      >
                        {msg.text && <div style={{ marginBottom: msg.file ? '8px' : '4px', wordWrap: 'break-word', color: '#000000' }}>{msg.text}</div>}
                        {msg.file && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: '4px' }}>
                            <Paperclip size={16} />
                            <span style={{ fontSize: '13px', color: '#667781' }}>{msg.file}</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', marginTop: '4px' }}>
                          <span style={{ fontSize: '11px', color: '#667781' }}>{formatMessageTime(msg.date)}</span>
                          {isFromMe && (
                            msg.isFailed ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <AlertCircle size={14} style={{ color: '#dc3545' }} />
                                <span style={{ fontSize: '10px', color: '#dc3545' }}>Failed</span>
                              </div>
                            ) : msg.isOptimistic ? (
                              <Clock size={14} style={{ color: '#95a5a6' }} title="Sending..." />
                            ) : msg.isDelivered ? (
                              <CheckCheck size={14} style={{ color: '#34b7f1' }} title="Delivered" />
                            ) : (
                              <Check size={14} style={{ color: '#95a5a6' }} title="Sent" />
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div style={{ padding: '12px 16px', backgroundColor: '#f0f2f5', borderTop: '1px solid #e0e0e0' }}>
              {file && (
                <div style={{ marginBottom: '8px', padding: '8px 12px', backgroundColor: '#ffffff', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Paperclip size={16} style={{ color: '#128C7E' }} />
                    <span style={{ fontSize: '14px', color: '#000000' }}>{file.name}</span>
                  </div>
                  <button onClick={handleRemoveFile} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                    <X size={18} style={{ color: '#dc3545' }} />
                  </button>
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                  accept="image/*,.pdf,.doc,.docx"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: '10px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #d1d7db',
                    borderRadius: '24px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <Paperclip size={20} style={{ color: '#667781' }} />
                </button>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Type a message"
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    borderRadius: '24px',
                    border: '1px solid #d1d7db',
                    resize: 'none',
                    fontSize: '15px',
                    fontFamily: 'Arial, sans-serif',
                    maxHeight: '100px',
                    minHeight: '40px'
                  }}
                  rows={1}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!message.trim() && !file}
                  style={{
                    padding: '10px',
                    backgroundColor: message.trim() || file ? '#128C7E' : '#d1d7db',
                    border: 'none',
                    borderRadius: '24px',
                    cursor: message.trim() || file ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background-color 0.2s'
                  }}
                >
                  <Send size={20} style={{ color: '#ffffff' }} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#667781' }}>
            <Users size={64} style={{ marginBottom: '16px', opacity: 0.5 }} />
            <h3 style={{ fontSize: '24px', marginBottom: '8px' }}>Welcome to Chat</h3>
            <p style={{ fontSize: '15px' }}>Select a conversation to start messaging</p>
          </div>
        )}
      </div>

      {/* Debug Panel */}
      {debugMode && (
        <div style={{ width: '320px', backgroundColor: '#1e1e1e', color: '#d4d4d4', padding: '16px', overflowY: 'auto', fontSize: '11px', fontFamily: 'Consolas, monospace', borderLeft: '1px solid #333' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, color: '#4ec9b0' }}>Debug Console</h3>
            <button onClick={() => setDebugLogs([])} style={{ background: '#333', border: 'none', color: '#d4d4d4', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '10px' }}>Clear</button>
          </div>
          <div style={{ marginBottom: '12px', padding: '8px', backgroundColor: '#2d2d2d', borderRadius: '4px' }}>
            <div><strong>Connection:</strong> {connectionState}</div>
            <div><strong>User ID:</strong> {user?.id}</div>
            <div><strong>Users:</strong> {users.length}</div>
            <div><strong>Messages:</strong> {messages.length}</div>
          </div>
          <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
            {debugLogs.map((log, i) => (
              <div key={i} style={{ marginBottom: '6px', padding: '6px', backgroundColor: log.type === 'error' ? '#571818' : log.type === 'warning' ? '#5e5217' : log.type === 'success' ? '#1a4d2e' : '#2d2d2d', borderRadius: '4px', borderLeft: `3px solid ${log.type === 'error' ? '#f14c4c' : log.type === 'warning' ? '#cca700' : log.type === 'success' ? '#4ec9b0' : '#007acc'}` }}>
                <div style={{ color: '#808080', fontSize: '9px', marginBottom: '2px' }}>{log.timestamp}</div>
                <div>{log.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatApp;
