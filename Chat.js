import React, { useState, useEffect, useRef } from 'react';
import { HubConnectionBuilder } from '@microsoft/signalr';
import Navbar from '../components/Nav';
import Footer from '../components/Footer';
import '../Chat/css/Chat.css';
import { useAuth } from '../Pages/AuthPage';
import { Accordion, AccordionSummary, AccordionDetails, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const svgContent = `<svg viewBox="0 0 97 76" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:47px;height:76px;">
  <path d="M1.91304 12L3.1087 12.2689L4.30435 13.6134L5.26087 16.5714L6.21739 25.4454L6.45652 28.4034L4.30435 30.5546L4.54348 32.7059L6.69565 35.9328L9.80435 40.7731L11.9565 43.4622L12.913 44L11.2391 41.8487L5.26087 32.437L5.02174 30.8235L6.93478 29.7479L8.36957 30.0168L11.4783 31.8992L13.6304 33.7815L15.7826 36.2017L18.413 39.9664L20.087 41.8487L21.7609 42.9244L27.5 43.7311L31.5652 45.0756L33.9565 46.4202L36.587 48.5714L39.4565 51.7983L41.6087 55.563L43.2826 59.5966L44 62.5546V66.8571L43.7609 68.7395L43.5217 75.7311L43.2826 76H28.2174L27.9783 75.7311L27.7391 68.4706L26.5435 65.7815V65.2437H26.0652V64.7059L25.1087 64.1681L18.8913 59.8655L13.3913 56.1008L10.0435 53.4118L7.8913 51.2605L5.02174 45.0756L1.91304 37.2773L0.23913 31.6303L0 30.0168V25.9832L0.717391 17.1092L1.43478 12.5378L1.91304 12Z" fill="#00959C"/>
  <path d="M94.788 12L95.7935 12.2689L96.3967 16.3025L97 25.9832V31.0924L95.5924 36.7395L94.1848 41.042L91.1685 49.1092L89.962 51.7983L88.3533 53.6807L84.1304 57.4454L79.7065 60.9412L76.288 63.8992L74.6793 65.7815L73.875 67.6639L73.6739 75.7311L73.4728 76H60.6033L60.4022 75.7311L60.2011 67.395L60 65.5126V63.3613L61.0054 58.2521L62.6141 54.2185L64.2228 51.5294L65.8315 49.1092L68.6467 46.1513L70.8587 44.8067L75.0815 43.4622L78.7011 42.9244L80.1087 41.8487L81.7174 39.9664L84.3315 35.395L86.3424 32.7059L89.5598 30.2857L90.163 30.0168H91.7717L92.9783 31.0924L92.1739 33.2437L89.5598 38.084L87.5489 41.8487L86.5435 43.4622L87.75 42.6555L89.1576 40.2353L91.7717 35.395L92.9783 33.2437L93.3804 31.8992L93.1793 30.2857L92.5761 29.479L91.5707 28.6723L91.7717 25.1765L92.5761 16.8403L93.3804 13.6134L94.3859 12.2689L94.788 12Z" fill="#00959C"/>
  <path d="M38.6 0L41.313 0.235577L44.2522 1.17788L47.8696 3.29808L48.3217 3.76923L49.6783 3.53365L52.6174 1.64904L55.7826 0.471154L57.8174 0H60.3043L64.8261 1.17788L68.4435 2.82692L70.7043 4.47596L72.7391 6.83173L74.3217 10.3654L75 14.3702V16.9615L74.3217 20.9663L73.1913 23.7933L71.1565 27.5625L68.6696 30.8606L66.6348 33.2163L65.0522 35.101L59.8522 40.5192L58.0435 42.1683L53.7478 46.6442L51.2609 48.5288L49.9043 49H47.8696L45.1565 47.5865L39.9565 42.1683L38.1478 40.5192L30.913 32.9808L29.3304 31.0962L27.0696 28.0337L25.0348 24.7356L23.6783 21.2019L23 18.1394V12.7212L24.1304 8.95192L25.713 6.125L27.9739 3.76923L30.2348 2.35577L33.8522 0.942308L38.6 0Z" fill="#00959C"/>
</svg>`;

const svgBackground = `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`;

const ChatApp = () => {
  const { user } = useAuth();
  const [connection, setConnection] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [message, setMessage] = useState('');
  const [file, setFile] = useState(null);
  const [messages, setMessages] = useState([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [userPhotos, setUserPhotos] = useState({});
  const [connectionError, setConnectionError] = useState(null);
  const [expandedCategories, setExpandedCategories] = useState({});

  const fileInputRef = useRef();
  const messagesEndRef = useRef(null);

  const fetchUserPhoto = async (fileName, role) => {
    if (!user?.accessToken || !fileName || !role) return null;
    const path = role.toLowerCase() === 'patient' ? 'Actor/Patients' : `Actors/${role.charAt(0).toUpperCase() + role.slice(1).toLowerCase()}`;
    try {
      const response = await fetch(
        `https://physiocareapp.runasp.net/api/v1/Upload/image?filename=${encodeURIComponent(fileName)}&path=${encodeURIComponent(path)}`,
        {
          method: 'GET',
          headers: { 
            'Authorization': `Bearer ${user.accessToken}`, 
            'Accept': 'image/*' 
          },
        }
      );
      if (response.ok) {
        const blob = await response.blob();
        const photoUrl = URL.createObjectURL(blob);
        setUserPhotos(prev => ({ ...prev, [fileName]: photoUrl })); // Use fileName as key
        return photoUrl;
      } else {
        console.error('Failed to fetch photo - Status:', response.status, 'FileName:', fileName, 'Path:', path, 'Response:', await response.text());
        return null;
      }
    } catch (error) {
      console.error('Error fetching user photo:', error, 'FileName:', fileName, 'Path:', path);
      if (error.message.includes('CORS')) setConnectionError('CORS error occurred while fetching user photo. Please contact the administrator.');
      return null;
    }
  };

  const fetchMessages = async (recipientId) => {
    if (!user?.accessToken || !user?.id) return;
    setIsLoadingMessages(true);
    try {
      const apiUrl = recipientId
        ? `https://physiocareapp.runasp.net/api/v1/Chat/get-all-messages?senderId=${user.id}&recipientId=${recipientId}`
        : `https://physiocareapp.runasp.net/api/v1/Chat/get-all-messages?senderId=${user.id}`;
      console.log('Fetching messages from:', apiUrl);
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
      console.log('Response status:', response.status);
      const responseText = await response.text();
      console.log('Raw response text:', responseText);
      let data;
      try {
        data = responseText ? JSON.parse(responseText) : [];
      } catch (parseError) {
        console.error('JSON parse error:', parseError, 'Raw response:', responseText);
        setConnectionError('Invalid response from server while fetching messages. Please contact the administrator.');
        setMessages([]);
        return;
      }
      if (response.ok) {
        if (Array.isArray(data) && data.length > 0) {
          const formattedMessages = data.map((m, index) => ({
            id: m.id || `hist-${m.senderId}-${m.recipientId}-${index}`,
            senderId: m.senderId,
            senderName: m.userName || 'Unknown User',
            recipientId: m.recipientId,
            text: m.messageText || '',
            date: m.date || new Date().toISOString(),
            file: m.imageFile || null,
            fileUrl: m.imageFile ? URL.createObjectURL(new Blob([m.imageFile], { type: 'image/jpeg' })) : null,
            fileType: m.imageFile ? 'image/jpeg' : null,
            type: m.senderId === user.id ? 'outgoing' : 'incoming',
            time: new Date(m.date).toLocaleString('en-US', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            }),
          }));
          setMessages(formattedMessages.sort((a, b) => new Date(a.date) - new Date(b.date)));
        } else {
          setMessages([]);
        }
      } else {
        console.error('Failed to fetch messages - Status:', response.status, 'Response:', responseText);
        setConnectionError(`Failed to fetch messages. Server returned status ${response.status}.`);
        setMessages([]);
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
      if (error.message.includes('CORS')) setConnectionError('CORS error occurred while fetching messages. Please contact the administrator.');
      else setConnectionError('Network error while fetching messages. Please try again later.');
      setMessages([]);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const fetchUsersByRole = async () => {
    if (!user?.accessToken || !user?.id || !user?.role) return;
    try {
      const response = await fetch(`https://physiocareapp.runasp.net/api/v1/Admins/get-all-basic-info-users-by-role?role=${user.role}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${user.accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
      const data = await response.json();
      console.log('API Response for users:', data);
      if (response.ok) {
        let filteredUsers = Array.isArray(data) ? data : [];
        const userRole = user.role || user.Role || user.userRole || 'unknown';
        if (userRole.toLowerCase() === 'patient') {
          filteredUsers = filteredUsers.filter(u => {
            const uRole = u.role || u.Role || u.userRole || 'unknown';
            return ['nurse', 'laboratory', 'doctor'].includes(uRole.toLowerCase()) && u.userId !== user.id;
          });
        } else {
          filteredUsers = filteredUsers.filter(u => {
            const uRole = u.role || u.Role || u.userRole || 'unknown';
            return uRole.toLowerCase() !== userRole.toLowerCase() && u.userId !== user.id;
          });
        }
        if (filteredUsers.length === 0) {
          console.warn('No users found after filtering. Check API response or role logic.');
        }
        setUsers(filteredUsers.map(u => ({
          id: u.userId,
          name: u.fullName || 'Unknown User',
          lastActive: u.lastActive || 'online',
          role: u.role || u.Role || u.userRole || 'unknown',
          fileName: u.fileName || `${u.userId}.jpg`, // Use fileName from API, fallback to userId.jpg
        })));
        filteredUsers.forEach(u => fetchUserPhoto(u.fileName, u.role));
      } else {
        console.error('Failed to fetch users - Status:', response.status, 'Response:', data);
        setConnectionError(`Failed to fetch users. Server returned status ${response.status}.`);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      if (error.message.includes('CORS')) setConnectionError('CORS error occurred while fetching users. Please contact the administrator.');
      else setConnectionError('Network error while fetching users. Please try again later.');
    }
  };

  useEffect(() => {
    if (!user?.accessToken || !user?.id || !user?.name) return;
    const newConnection = new HubConnectionBuilder()
      .withUrl('https://physiocareapp.runasp.net/chatHub', { accessTokenFactory: () => user.accessToken })
      .withAutomaticReconnect()
      .build();

    const startConnection = async (retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          await newConnection.start();
          console.log('Connected to SignalR hub');
          setConnectionError(null);
          break;
        } catch (err) {
          console.error(`Connection attempt ${i + 1} failed:`, err.message);
          if (i === retries - 1) {
            setConnectionError('Failed to connect to the chat server due to a CORS issue. Please contact the administrator.');
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    };

    startConnection()
      .then(() => {
        newConnection.on('UpdateUserList', (userList) => {
          console.log('Received updated user list:', userList);
          let filteredUsers = userList;
          const userRole = user.role || user.Role || user.userRole || 'unknown';
          if (userRole.toLowerCase() === 'patient') {
            filteredUsers = userList.filter(u => {
              const uRole = u.role || u.Role || u.userRole || 'unknown';
              return ['nurse', 'laboratory', 'doctor'].includes(uRole.toLowerCase()) && u.userId !== user.id;
            });
          } else {
            filteredUsers = userList.filter(u => {
              const uRole = u.role || u.Role || u.userRole || 'unknown';
              return uRole.toLowerCase() !== userRole.toLowerCase() && u.userId !== user.id;
            });
          }
          if (filteredUsers.length === 0) {
            console.warn('No users found after SignalR filtering. Check userList data.');
          }
          setUsers(filteredUsers.map(user => ({
            id: user.userId,
            name: user.fullName || 'Unknown User',
            lastActive: user.lastActive || 'online',
            role: user.role || user.Role || user.userRole || 'unknown',
            fileName: user.fileName || `${user.userId}.jpg`,
          })));
          filteredUsers.forEach(user => fetchUserPhoto(user.fileName, user.role));
        });

        newConnection.on('ReceiveMessage', (senderId, msg) => {
          console.log('Raw message received:', msg);
          try {
            let parsed = typeof msg === 'string' ? JSON.parse(msg) : msg;
            console.log('Parsed message payload:', parsed);
            if (senderId !== user.id) {
              const now = new Date();
              const time = now.toLocaleString('en-US', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
              });

              const newMessage = {
                id: `m${Date.now()}-${Math.random()}`,
                senderId: parsed.SenderId || senderId,
                senderName: parsed.UserName || 'Unknown',
                recipientId: parsed.RecipientId,
                text: parsed.MessageText || parsed.message || msg.toString().substring(0, 100),
                date: parsed.Date || now.toISOString(),
                file: parsed.ImageFile || null,
                fileUrl: parsed.ImageFile ? URL.createObjectURL(new Blob([parsed.ImageFile], { type: 'image/jpeg' })) : null,
                fileType: parsed.ImageFile ? 'image/jpeg' : null,
                type: senderId === user.id ? 'outgoing' : 'incoming',
                time,
              };

              setMessages(prev => {
                const isDuplicate = prev.some(m => 
                  m.senderId === newMessage.senderId && 
                  m.recipientId === newMessage.recipientId && 
                  m.text === newMessage.text && 
                  Math.abs(new Date(m.date) - new Date(newMessage.date)) < 1000
                );
                return isDuplicate ? prev : [...prev, newMessage];
              });
            }
          } catch (parseError) {
            console.error('Error parsing received message:', parseError, 'Raw data:', msg);
          }
        });
      })
      .catch(err => {
        console.error('SignalR connection error:', err.message);
        if (err.message.includes('CORS')) setConnectionError('CORS error occurred while connecting to the chat server. Please contact the administrator.');
      });

    setConnection(newConnection);
    return () => { if (newConnection) newConnection.stop(); };
  }, [user?.accessToken, user?.id, user?.name, user?.role]);

  useEffect(() => {
    if (user?.accessToken && user?.id) {
      fetchMessages();
      fetchUserPhoto(user.fileName || `${user.id}.jpg`, user.role || user.Role || 'default');
      fetchUsersByRole();
    }
  }, [user?.accessToken, user?.id, user?.role, user?.Role, user?.fileName]);

  useEffect(() => {
    if (selectedUser && user?.accessToken && user?.id) {
      fetchMessages(selectedUser.id);
      fetchUserPhoto(selectedUser.fileName || `${selectedUser.id}.jpg`, selectedUser.role || selectedUser.Role || 'default');
    } else if (!selectedUser) {
      setMessages([]);
    }
  }, [selectedUser, user?.accessToken, user?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if ((message.trim() === '' && !file) || !selectedUser) return;
    try {
      const now = new Date();
      const messageDto = {
        SenderId: user.id,
        RecipientId: selectedUser.id,
        Date: now.toISOString(),
        MessageText: message.trim(),
        UserName: user.name || user.userName || 'Unknown User',
        ImageFile: file,
      };
      const formData = new FormData();
      for (let key in messageDto) formData.append(key, messageDto[key]);
      if (file) formData.append('ImageFile', file);

      const response = await fetch('https://physiocareapp.runasp.net/api/v1/Chat/sendmessage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.accessToken}` },
        body: formData,
      });
      if (response.ok) {
        const imageFileUrl = file ? URL.createObjectURL(file) : null;
        const newMessage = {
          id: `m${Date.now()}`,
          senderId: user.id,
          senderName: user.name || user.userName || 'Unknown User',
          recipientId: selectedUser.id,
          text: message.trim(),
          date: now.toISOString(),
          file: imageFileUrl,
          fileUrl: imageFileUrl,
          fileType: file ? file.type : null,
          type: 'outgoing',
          time: now.toLocaleString('en-US', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          }),
        };
        setMessages(prev => {
          const isDuplicate = prev.some(m => 
            m.senderId === newMessage.senderId && 
            m.recipientId === newMessage.recipientId && 
            m.text === newMessage.text && 
            Math.abs(new Date(m.date) - new Date(newMessage.date)) < 1000
          );
          return isDuplicate ? prev : [...prev, newMessage];
        });
        if (connection) {
          await connection.invoke('SendMessage', {
            SenderId: user.id,
            RecipientId: selectedUser.id,
            Date: now.toISOString(),
            MessageText: message.trim(),
            UserName: user.name || user.userName || 'Unknown User',
            ImageFile: file ? await file.arrayBuffer() : null,
          });
        }
        setMessage('');
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        throw new Error(`API call failed: ${await response.text()}`);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      if (error.message.includes('CORS')) setConnectionError('CORS error occurred while sending message. Please contact the administrator.');
      else alert('Failed to send message. Please try again.');
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      if (selectedFile.type.startsWith('image/')) {
        const img = new Image();
        img.src = URL.createObjectURL(selectedFile);
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxSize = 200;
          let width = img.width;
          let height = img.height;
          if (width > height) {
            if (width > maxSize) {
              height *= maxSize / width;
              width = maxSize;
            }
          } else {
            if (height > maxSize) {
              width *= maxSize / height;
              height = maxSize;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            setFile(new File([blob], selectedFile.name, { type: 'image/jpeg' }));
          }, 'image/jpeg', 0.8);
        };
      } else {
        setFile(selectedFile);
      }
    }
  };

  const handleEmojiClick = (emoji) => { setMessage(prev => prev + emoji); setShowEmojiPicker(false); };
  const handleUserSelect = (user) => { setSelectedUser(user); setShowEmojiPicker(false); };

  const filteredUsers = users;

  const categories = {
    'Laboratory': filteredUsers.filter(u => u.role.toLowerCase() === 'laboratory'),
    'Nurse': filteredUsers.filter(u => u.role.toLowerCase() === 'nurse'),
    'Doctor': filteredUsers.filter(u => u.role.toLowerCase() === 'doctor'),
  };

  const toggleCategory = (category) => {
    setExpandedCategories(prev => ({ ...prev, [category]: !prev[category] }));
  };

  return (
    <>
      <Navbar />
      <div className="chat-container">
        <div className="users-panel" style={{ width: '300px', backgroundColor: '#f8f9fa', borderRight: '1px solid #dee2e6', padding: '10px' }}>
          <div className="users-list" style={{ maxHeight: 'calc(100vh - 150px)', overflowY: 'auto' }}>
            {Object.entries(categories).map(([category, usersInCategory]) => (
              usersInCategory.length > 0 && (
                <Accordion
                  key={category}
                  expanded={expandedCategories[category] || false}
                  onChange={() => toggleCategory(category)}
                  sx={{ backgroundColor: 'transparent', boxShadow: 'none', '&:before': { display: 'none' } }}
                >
                  <AccordionSummary
                    expandIcon={<ExpandMoreIcon />}
                    aria-controls={`${category}-content`}
                    id={`${category}-header`}
                    sx={{ padding: '0 10px', minHeight: '48px' }}
                  >
                    <Typography sx={{ fontWeight: 'bold', color: '#333' }}>{category} ({usersInCategory.length})</Typography>
                  </AccordionSummary>
                  <AccordionDetails sx={{ padding: '0 10px 10px' }}>
                    {usersInCategory.map(user => (
                      <div
                        key={user.id}
                        className={`user-item ${selectedUser?.id === user.id ? 'selected' : ''}`}
                        onClick={() => handleUserSelect(user)}
                        style={{
                          display: 'flex', alignItems: 'center', padding: '10px', borderBottom: '1px solid #eee', cursor: 'pointer',
                          backgroundColor: selectedUser?.id === user.id ? '#e9ecef' : 'transparent',
                          transition: 'background-color 0.3s',
                          borderRadius: '4px',
                          marginBottom: '5px',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f1f3f5')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = selectedUser?.id === user.id ? '#e9ecef' : 'transparent')}
                      >
                        <img
                          src={userPhotos[user.fileName] || '/default-avatar.png'} // Use fileName as key for photo
                          alt={`${user.name || 'Unknown User'}'s photo`}
                          className="user-avatar"
                          style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '50%', marginRight: '10px' }}
                        />
                        <div className="user-info" style={{ flexGrow: 1 }}>
                          <div className="user-name" style={{ fontWeight: '500', color: '#333' }}>{user.name || 'Unknown User'}</div>
                          <div className={`user-status ${user.lastActive.toLowerCase()}`} style={{ fontSize: '0.8rem', color: user.lastActive.toLowerCase() === 'online' ? '#28a745' : '#6c757d' }}>
                            {user.lastActive}
                          </div>
                        </div>
                      </div>
                    ))}
                  </AccordionDetails>
                </Accordion>
              )
            ))}
            {users.length === 0 && <div style={{ padding: '10px', color: '#dc3545' }}>No users available. Check API response or role filters.</div>}
          </div>
        </div>
        <div className="chat-window">
          <div className="chat-background-svg" style={{ backgroundImage: `url("${svgBackground}")` }} />
          <div className="chat-header">
            <div className="selected-user-info">
              {selectedUser && userPhotos[selectedUser.fileName] && (
                <img
                  src={userPhotos[selectedUser.fileName] || '/default-avatar.png'}
                  alt={`${selectedUser.name || 'Unknown User'}'s photo`}
                  className="selected-user-avatar"
                  style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '50%', marginRight: '10px' }}
                />
              )}
              <div><h2>{selectedUser ? `Chatting with ${selectedUser.name || 'Unknown User'}` : 'Select a user to start chatting'}</h2></div>
            </div>
          </div>
          <div className="chat-messages">
            {connectionError && <div className="no-messages" style={{ color: '#dc3545' }}>{connectionError}</div>}
            {isLoadingMessages && <div className="no-messages">Loading message history...</div>}
            {!isLoadingMessages && !connectionError && messages.length === 0 && selectedUser && <div className="no-messages">No messages yet with {selectedUser.name || 'Unknown User'}</div>}
            {!isLoadingMessages && !connectionError && !selectedUser && messages.length === 0 && <div className="no-messages">Select a user from the left panel to start chatting</div>}
            {!isLoadingMessages && !connectionError && messages.length > 0 && <div style={{ fontSize: '0.75rem', color: '#6c757d', textAlign: 'center', padding: '0.5rem' }}>{selectedUser ? `Conversation with ${selectedUser.name || 'Unknown User'} (${messages.length} messages)` : `All messages (${messages.length})`}</div>}
            {!isLoadingMessages && !connectionError && messages.map((msg) => {
              const isOutgoing = msg.type === 'outgoing';
              return (
                <div key={msg.id} className={`message-container ${isOutgoing ? 'outgoing' : 'incoming'}`}>
                  {!isOutgoing && userPhotos[msg.senderId] && <img src={userPhotos[msg.senderId] || '/default-avatar.png'} alt={`${msg.senderName}'s photo`} className="message-avatar" style={{ width: '30px', height: '30px', objectFit: 'cover', marginRight: '10px', borderRadius: '50%' }} />}
                  <div className={`message ${isOutgoing ? 'sent' : 'received'}`}>
                    {msg.fileUrl && msg.fileType?.startsWith('image/') && <div className="message-image-container"><img src={msg.fileUrl} alt="Attached" className="message-image" style={{ maxWidth: '200px', maxHeight: '200px', objectFit: 'contain' }} /></div>}
                    {msg.text && <p className="message-text">{msg.text}</p>}
                    {msg.file && !msg.fileType?.startsWith('image/') && <div className="message-file"><svg className="file-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></svg><span>{msg.file.name || msg.file}</span></div>}
                    <div className="message-time">{msg.time} {isOutgoing ? '(You)' : `(${msg.senderName})`}</div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
          <div className="chat-input-container">
            {showEmojiPicker && <div className="emoji-picker">{['😊', '😂', '❤️', '👍', '🎉', '🙏', '😷', '🤒', '🔥', '👋', '🥳', '🤔'].map(emoji => <button key={emoji} className="emoji-btn" onClick={() => handleEmojiClick(emoji)}>{emoji}</button>)}</div>}
            <div className="chat-input">
              <button className="emoji-toggle-btn" onClick={() => setShowEmojiPicker(!showEmojiPicker)} title="Select emoji" disabled={!selectedUser || connectionError}>😊</button>
              <input type="text" placeholder={selectedUser ? "Type your message..." : "Select a user to start chatting"} value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendMessage()} className="message-input" disabled={!selectedUser || connectionError} />
              <div className="chat-actions">
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*,application/pdf" style={{ display: 'none' }} />
                <button className="file-attach-btn" onClick={() => fileInputRef.current?.click()} title="Attach file" disabled={!selectedUser || connectionError}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="M9 15h6"/></svg></button>
                <button className="send-btn" onClick={sendMessage} aria-label="Send message" disabled={!selectedUser || (message.trim() === '' && !file) || connectionError} />
              </div>
            </div>
            {file && <div className="selected-file"><span>{file.name}</span><button className="remove-file-btn" onClick={() => { setFile(null); fileInputRef.current.value = ''; }}>×</button></div>}
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
};

export default ChatApp;