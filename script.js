// Voice AI Assistant - Main Application Logic
class VoiceAIAssistant {
    constructor() {
        this.apiKey = '';
        this.isListening = false;
        this.recognition = null;
        this.conversationHistory = [];
        this.currentConversationIndex = 0;
        this.conversationPairs = []; // Store Q&A pairs for navigation
        this.currentTranscript = '';
        this.microphonePermission = 'unknown'; // 'granted', 'denied', 'unknown'
        this.permissionChecked = false;
        
        // Google Cloud TTS Configuration (REMOVED FOR SECURITY)
        this.gcpCredentials = null; // Place your GCP credentials here if needed (do NOT commit secrets)
        this.gcpAccessToken = null;
        this.gcpTokenExpiry = null;
        this.useGoogleTTS = false; // Always use browser TTS fallback
        this.preferredVoice = 'en-IN-Neural2-B'; // High-quality Indian English female voice
        
        // ENHANCED AUDIO STATE MANAGEMENT
        this.audioManager = {
            currentAudio: null,
            audioQueue: [],
            isPlaying: false,
            isPaused: false,
            currentSpeaker: null, // Track which element is currently speaking
            currentText: '',
            playbackState: 'stopped' // 'stopped', 'playing', 'paused'
        };
        
        // Fallback to browser TTS properties
        this.speechSynthesis = window.speechSynthesis;
        this.currentUtterance = null;
        this.isSpeaking = false;
        
        // Live TTS properties
        this.liveTTSEnabled = true;
        this.ttsQueue = [];
        this.ttsSpeed = 0.9;
        this.streamingText = '';
        
        // Initialize Google Cloud TTS
        this.initializeGoogleTTS();
        
        // Load voices when available (fallback)
        if (this.speechSynthesis) {
            // Chrome loads voices asynchronously
            this.speechSynthesis.onvoiceschanged = () => {
                const voices = this.speechSynthesis.getVoices();
                console.log('Speech synthesis voices loaded:', voices.length);
                
                // Log available high-quality voices for debugging
                const qualityVoices = voices.filter(voice => 
                    voice.lang.startsWith('en') && 
                    (voice.localService || /neural|premium|enhanced|natural|samantha|alex|victoria/i.test(voice.name))
                );
                if (qualityVoices.length > 0) {
                    console.log('High-quality voices available:', qualityVoices.map(v => v.name));
                }
            };
            
            // Trigger voice loading for Chrome
            this.speechSynthesis.getVoices();
        }
        
        this.initializeElements();
        this.setupEventListeners();
        this.checkMicrophonePermission().then(() => {
            this.initializeSpeechRecognition();
        });
        this.loadSavedApiKey();
        this.loadSavedVoicePreference();
        this.loadSavedTTSSettings();
        this.initializeConversationView();
        
        // CRITICAL: Ensure toggle state is properly initialized after DOM is ready
        setTimeout(() => {
            this.updateToggleVisualState();
            console.log('Toggle initialization complete. Current state:', this.liveTTSEnabled);
            
            // Add global debug methods
            window.debugToggle = () => this.debugToggleState();
            window.forceToggleOn = () => this.forceToggleVisualState(true);
            window.forceToggleOff = () => this.forceToggleVisualState(false);
            window.toggleClick = () => document.querySelector('.toggle-slider').click();
            window.resetToggle = () => this.resetToggleButton();
            console.log('Debug methods added:');
            console.log('  - window.debugToggle() - Debug current state');
            console.log('  - window.forceToggleOn() - Force toggle ON');
            console.log('  - window.forceToggleOff() - Force toggle OFF');
            console.log('  - window.toggleClick() - Simulate click');
            console.log('  - window.resetToggle() - Reset toggle button');
        }, 100);
    }

    // Initialize Google Cloud TTS authentication
    async initializeGoogleTTS() {
        try {
            console.log('Initializing Google Cloud TTS...');
            await this.getGCPAccessToken();
            console.log('Google Cloud TTS initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Google Cloud TTS:', error);
            this.useGoogleTTS = false; // Fallback to browser TTS
            console.log('Falling back to browser TTS');
        }
    }

    // Get Google Cloud Platform access token
    async getGCPAccessToken() {
        try {
            // Check if we have a valid token
            if (this.gcpAccessToken && this.gcpTokenExpiry && Date.now() < this.gcpTokenExpiry) {
                return this.gcpAccessToken;
            }

            console.log('Getting new GCP access token...');
            
            // Create JWT for authentication
            const header = {
                alg: 'RS256',
                typ: 'JWT'
            };

            const now = Math.floor(Date.now() / 1000);
            const payload = {
                iss: this.gcpCredentials.client_email,
                scope: 'https://www.googleapis.com/auth/cloud-platform',
                aud: this.gcpCredentials.token_uri,
                exp: now + 3600, // 1 hour
                iat: now
            };

            // Create JWT token
            const jwt = await this.createJWT(header, payload, this.gcpCredentials.private_key);
            
            // Exchange JWT for access token
            const response = await fetch(this.gcpCredentials.token_uri, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
            });

            if (!response.ok) {
                throw new Error(`Token request failed: ${response.status}`);
            }

            const data = await response.json();
            this.gcpAccessToken = data.access_token;
            this.gcpTokenExpiry = Date.now() + (data.expires_in * 1000);
            
            console.log('GCP access token obtained successfully');
            return this.gcpAccessToken;
            
        } catch (error) {
            console.error('Error getting GCP access token:', error);
            throw error;
        }
    }

    // Create JWT token for Google Cloud authentication
    async createJWT(header, payload, privateKey) {
        try {
            const encoder = new TextEncoder();
            
            // Base64URL encode header and payload
            const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
            const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
            const message = `${encodedHeader}.${encodedPayload}`;
            
            // Import the private key
            const keyData = this.parsePrivateKey(privateKey);
            const cryptoKey = await window.crypto.subtle.importKey(
                'pkcs8',
                keyData,
                {
                    name: 'RSASSA-PKCS1-v1_5',
                    hash: 'SHA-256'
                },
                false,
                ['sign']
            );
            
            // Sign the message
            const signature = await window.crypto.subtle.sign(
                'RSASSA-PKCS1-v1_5',
                cryptoKey,
                encoder.encode(message)
            );
            
            // Base64URL encode signature
            const encodedSignature = this.base64UrlEncode(signature);
            
            return `${message}.${encodedSignature}`;
        } catch (error) {
            console.error('Error creating JWT:', error);
            throw error;
        }
    }

    // Parse private key from PEM format
    parsePrivateKey(pem) {
        const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '')
                      .replace(/-----END PRIVATE KEY-----/, '')
                      .replace(/\s/g, '');
        return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    }

    // Base64URL encode
    base64UrlEncode(data) {
        if (typeof data === 'string') {
            data = new TextEncoder().encode(data);
        }
        return btoa(String.fromCharCode(...new Uint8Array(data)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
    }

    // Synthesize speech with Google Cloud TTS
    async synthesizeWithGoogleTTS(text) {
        try {
            const accessToken = await this.getGCPAccessToken();
            
            // Determine language code from voice
            const languageCode = this.preferredVoice.startsWith('en-IN') ? 'en-IN' : 'en-US';
            
            const requestBody = {
                input: {
                    text: this.cleanTextForTTS(text)
                },
                voice: {
                    languageCode: languageCode,
                    name: this.preferredVoice
                },
                audioConfig: {
                    audioEncoding: 'MP3',
                    speakingRate: this.ttsSpeed,
                    pitch: 0.0,
                    volumeGainDb: 0.0
                }
            };

            const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new Error(`TTS request failed: ${response.status}`);
            }

            const data = await response.json();
            return data.audioContent;
            
        } catch (error) {
            console.error('Error synthesizing with Google TTS:', error);
            throw error;
        }
    }

    // Clean text for better TTS pronunciation
    cleanTextForTTS(text) {
        // Remove markdown formatting
        let cleanText = text.replace(/\*\*(.*?)\*\*/g, '$1');
        cleanText = cleanText.replace(/\*(.*?)\*/g, '$1');
        cleanText = cleanText.replace(/`(.*?)`/g, '$1');
        cleanText = cleanText.replace(/#{1,6}\s/g, '');
        
        // Remove emojis
        cleanText = cleanText.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '');
        
        // Handle common abbreviations and acronyms
        cleanText = cleanText.replace(/\bAPI\b/g, 'A P I');
        cleanText = cleanText.replace(/\bHTML\b/g, 'H T M L');
        cleanText = cleanText.replace(/\bCSS\b/g, 'C S S');
        cleanText = cleanText.replace(/\bJS\b/g, 'JavaScript');
        cleanText = cleanText.replace(/\bJSON\b/g, 'J S O N');
        cleanText = cleanText.replace(/\bURL\b/g, 'U R L');
        cleanText = cleanText.replace(/\bHTTP\b/g, 'H T T P');
        cleanText = cleanText.replace(/\bHTTPS\b/g, 'H T T P S');
        cleanText = cleanText.replace(/\bAI\b/g, 'A I');
        cleanText = cleanText.replace(/\bML\b/g, 'M L');
        cleanText = cleanText.replace(/\bUI\b/g, 'U I');
        cleanText = cleanText.replace(/\bUX\b/g, 'U X');
        
        // Handle version numbers
        cleanText = cleanText.replace(/v(\d+)\.(\d+)/g, 'version $1 point $2');
        cleanText = cleanText.replace(/(\d+)\.(\d+)/g, '$1 point $2');
        
        // Add natural pauses
        cleanText = cleanText.replace(/\. /g, '. ');
        cleanText = cleanText.replace(/\? /g, '? ');
        cleanText = cleanText.replace(/! /g, '! ');
        cleanText = cleanText.replace(/: /g, ': ');
        cleanText = cleanText.replace(/; /g, '; ');
        
        return cleanText.trim();
    }

    // ENHANCED AUDIO MANAGEMENT
    async playAudioFromBase64(base64Audio, button = null, isStreaming = false) {
        try {
            // Stop any existing audio
            this.stopAllAudio();
            
            // Convert base64 to blob
            const audioBytes = atob(base64Audio);
            const audioArray = new Uint8Array(audioBytes.length);
            for (let i = 0; i < audioBytes.length; i++) {
                audioArray[i] = audioBytes.charCodeAt(i);
            }
            
            const audioBlob = new Blob([audioArray], { type: 'audio/mpeg' });
            const audioUrl = URL.createObjectURL(audioBlob);
            
            // Create new audio element
            const audio = new Audio(audioUrl);
            audio.playbackRate = this.ttsSpeed;
            
            // Update audio manager
            this.audioManager.currentAudio = audio;
            this.audioManager.isPlaying = true;
            this.audioManager.isPaused = false;
            this.audioManager.currentSpeaker = button;
            this.audioManager.playbackState = 'playing';
            
            // Update button state
            if (button) {
                this.updateSpeakButtonState(button, 'playing');
            }
            
            // Update TTS controls
            this.updateTTSControls();
            
            // Audio event listeners
            audio.addEventListener('play', () => {
                console.log('Audio playback started');
                this.audioManager.playbackState = 'playing';
                this.updateTTSControls();
            });
            
            audio.addEventListener('pause', () => {
                console.log('Audio playback paused');
                this.audioManager.playbackState = 'paused';
                this.updateTTSControls();
            });
            
            audio.addEventListener('ended', () => {
                console.log('Audio playback ended');
                this.audioManager.playbackState = 'stopped';
                this.audioManager.isPlaying = false;
                this.audioManager.currentSpeaker = null;
                
                // Clean up
                URL.revokeObjectURL(audioUrl);
                
                // Update button state
                if (button) {
                    this.updateSpeakButtonState(button, 'stopped');
                }
                
                // Update TTS controls
                this.updateTTSControls();
                
                // Play next in queue if available
                if (this.ttsQueue.length > 0 && this.liveTTSEnabled) {
                    this.playNextInQueue();
                }
            });
            
            audio.addEventListener('error', (e) => {
                console.error('Audio playback error:', e);
                this.audioManager.playbackState = 'stopped';
                this.audioManager.isPlaying = false;
                this.audioManager.currentSpeaker = null;
                
                // Clean up
                URL.revokeObjectURL(audioUrl);
                
                // Update button state
                if (button) {
                    this.updateSpeakButtonState(button, 'stopped');
                }
                
                // Update TTS controls
                this.updateTTSControls();
            });
            
            // Start playback
            await audio.play();
            
        } catch (error) {
            console.error('Error playing audio:', error);
            this.audioManager.playbackState = 'stopped';
            this.audioManager.isPlaying = false;
            this.audioManager.currentSpeaker = null;
            
            // Update button state
            if (button) {
                this.updateSpeakButtonState(button, 'stopped');
            }
            
            // Update TTS controls
            this.updateTTSControls();
        }
    }
    
    // Update speak button visual state
    updateSpeakButtonState(button, state) {
        if (!button) return;
        
        const icon = button.querySelector('i');
        if (!icon) return;
        
        // Remove all state classes
        button.classList.remove('speaking', 'paused', 'stopped');
        
        switch (state) {
            case 'playing':
                button.classList.add('speaking');
                icon.className = 'fas fa-stop';
                button.title = 'Stop speaking';
                break;
            case 'paused':
                button.classList.add('paused');
                icon.className = 'fas fa-play';
                button.title = 'Resume speaking';
                break;
            case 'stopped':
            default:
                button.classList.add('stopped');
                icon.className = 'fas fa-volume-up';
                button.title = 'Speak response';
                break;
        }
    }

    // Queue audio chunk for streaming
    async queueAudioChunk(text) {
        if (!this.liveTTSEnabled || !text.trim()) return;
        
        this.ttsQueue.push(text);
        
        // Start playing if not already playing
        if (!this.audioManager.isPlaying) {
            this.playNextInQueue();
        }
    }

    // Play next audio chunk in queue
    async playNextInQueue() {
        if (this.ttsQueue.length === 0 || this.audioManager.isPlaying) return;
        
        const text = this.ttsQueue.shift();
        try {
            if (this.useGoogleTTS) {
                const audioContent = await this.synthesizeWithGoogleTTS(text);
                await this.playAudioFromBase64(audioContent, null, true);
            } else {
                // Use browser TTS for queue
                await this.speakWithBrowserTTS(text, null, true);
            }
        } catch (error) {
            console.error('Error playing queued audio:', error);
            // Continue with next chunk
            if (this.ttsQueue.length > 0) {
                setTimeout(() => this.playNextInQueue(), 100);
            }
        }
    }

    // Pause audio
    pauseAudio() {
        if (this.audioManager.currentAudio && !this.audioManager.currentAudio.paused) {
            this.audioManager.currentAudio.pause();
            this.audioManager.isPaused = true;
            this.audioManager.playbackState = 'paused';
        }
        
        // Pause browser TTS
        if (this.speechSynthesis && this.speechSynthesis.speaking) {
            this.speechSynthesis.pause();
        }
        
        this.updateTTSControls();
    }

    // Resume audio
    resumeAudio() {
        if (this.audioManager.currentAudio && this.audioManager.currentAudio.paused) {
            this.audioManager.currentAudio.play();
            this.audioManager.isPaused = false;
            this.audioManager.playbackState = 'playing';
        }
        
        // Resume browser TTS
        if (this.speechSynthesis && this.speechSynthesis.paused) {
            this.speechSynthesis.resume();
        }
        
        this.updateTTSControls();
    }

    // Stop all audio
    stopAllAudio() {
        console.log('Stopping all audio...');
        
        // Stop Google TTS audio
        if (this.audioManager.currentAudio) {
            this.audioManager.currentAudio.pause();
            this.audioManager.currentAudio.currentTime = 0;
            this.audioManager.currentAudio = null;
        }
        
        // Stop browser TTS
        if (this.speechSynthesis) {
            this.speechSynthesis.cancel();
        }
        
        // Clear queue
        this.ttsQueue = [];
        
        // Reset all state
        this.audioManager.isPlaying = false;
        this.audioManager.isPaused = false;
        this.audioManager.playbackState = 'stopped';
        this.isSpeaking = false;
        this.currentUtterance = null;
        
        // Update all speak buttons
        document.querySelectorAll('.speak-btn').forEach(btn => {
            this.updateSpeakButtonState(btn, 'stopped');
        });
        
        // Update previous speaker
        if (this.audioManager.currentSpeaker) {
            this.updateSpeakButtonState(this.audioManager.currentSpeaker, 'stopped');
        }
        
        this.audioManager.currentSpeaker = null;
        
        // Update TTS controls
        this.updateTTSControls();
    }

    // Update TTS control buttons
    updateTTSControls() {
        const playPauseBtn = document.getElementById('tts-play-pause');
        const playPauseIcon = playPauseBtn?.querySelector('i');
        
        if (playPauseBtn && playPauseIcon) {
            if (this.audioManager.playbackState === 'playing') {
                playPauseIcon.className = 'fas fa-pause';
                playPauseBtn.title = 'Pause';
            } else {
                playPauseIcon.className = 'fas fa-play';
                playPauseBtn.title = 'Play';
            }
        }
    }

    // Restart current conversation audio
    restartCurrentConversationAudio() {
        if (this.conversationPairs.length > 0) {
            const currentPair = this.conversationPairs[this.currentConversationIndex];
            if (currentPair && currentPair.answer) {
                this.speakText(currentPair.answer);
            }
        }
    }

    // Skip to end of current audio
    skipToEnd() {
        if (this.audioManager.currentAudio) {
            this.audioManager.currentAudio.currentTime = this.audioManager.currentAudio.duration;
        }
    }

    // Initialize DOM elements
    initializeElements() {
        this.geminiKeyInput = document.getElementById('gemini-key');
        this.toggleKeyBtn = document.getElementById('toggle-key-visibility');
        this.micButton = document.getElementById('mic-button');
        this.statusText = document.getElementById('status-text');
        this.liveTranscript = document.getElementById('live-transcript');
        this.chatContainer = document.getElementById('chat-container');
        this.clearChatBtn = document.getElementById('clear-chat');
        this.textInput = document.getElementById('text-input');
        this.sendButton = document.getElementById('send-button');
        this.audioVisualizer = document.getElementById('audio-visualizer');
        this.typingIndicator = document.getElementById('typing-indicator');
        this.errorToast = document.getElementById('error-toast');
        this.errorMessage = document.getElementById('error-message');
        this.closeErrorBtn = document.getElementById('close-error');
        this.prevBtn = document.getElementById('prev-btn');
        this.nextBtn = document.getElementById('next-btn');
        
        // TTS Control Elements
        this.voiceSelect = document.getElementById('voice-select');
        this.liveTTSToggle = document.getElementById('live-tts-toggle');
        this.ttsPlayPauseBtn = document.getElementById('tts-play-pause');
        this.ttsStopBtn = document.getElementById('tts-stop');
        this.ttsSkipBtn = document.getElementById('tts-skip');
        this.ttsSpeedSlider = document.getElementById('tts-speed');
        this.ttsSpeedValue = document.getElementById('tts-speed-value');
        
        if (!this.geminiKeyInput || !this.micButton || !this.statusText || !this.chatContainer) {
            console.error('Required DOM elements not found');
            return;
        }
        
        console.log('DOM elements initialized successfully');
    }

    // Setup event listeners
    setupEventListeners() {
        this.geminiKeyInput.addEventListener('input', this.handleApiKeyInput.bind(this));
        this.toggleKeyBtn.addEventListener('click', this.toggleKeyVisibility.bind(this));
        this.micButton.addEventListener('click', this.toggleListening.bind(this));
        this.clearChatBtn.addEventListener('click', this.clearConversation.bind(this));
        this.textInput.addEventListener('keypress', this.handleTextInputKeypress.bind(this));
        this.sendButton.addEventListener('click', this.sendTextMessage.bind(this));
        this.closeErrorBtn.addEventListener('click', this.hideError.bind(this));
        this.prevBtn.addEventListener('click', this.showPreviousConversation.bind(this));
        this.nextBtn.addEventListener('click', this.showNextConversation.bind(this));
        
        // FIXED: Voice selection event listener
        if (this.voiceSelect) {
            this.voiceSelect.addEventListener('change', this.handleVoiceSelection.bind(this));
        }
        
        // FIXED: Live TTS control event listeners with proper toggle handling
        if (this.liveTTSToggle) {
            // Primary change event handler
            this.liveTTSToggle.addEventListener('change', this.handleLiveTTSToggle.bind(this));
            
            // Enhanced click handler for toggle slider
            const toggleSlider = document.querySelector('.toggle-slider');
            const ttsToggleContainer = document.querySelector('.tts-toggle');
            
            if (toggleSlider && ttsToggleContainer) {
                // Simplified click handler that directly toggles the checkbox
                const handleToggleClick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    console.log('Toggle clicked - current state:', this.liveTTSToggle.checked);
                    
                    // Add visual click feedback
                    toggleSlider.classList.add('clicked');
                    setTimeout(() => toggleSlider.classList.remove('clicked'), 150);
                    
                    // Toggle the checkbox state
                    this.liveTTSToggle.checked = !this.liveTTSToggle.checked;
                    
                    console.log('Toggle new state:', this.liveTTSToggle.checked);
                    
                    // Directly call the toggle handler with a synthetic event
                    this.handleLiveTTSToggle({ target: this.liveTTSToggle });
                };
                
                // Add click handler to the slider
                toggleSlider.addEventListener('click', handleToggleClick);
                
                // Also handle clicks on the entire toggle container
                ttsToggleContainer.addEventListener('click', (e) => {
                    // Only trigger if clicking on the slider or label area
                    if (e.target.classList.contains('toggle-slider') || 
                        e.target.tagName === 'LABEL' || 
                        e.target === ttsToggleContainer) {
                        handleToggleClick(e);
                    }
                });
            }
        }
        
        if (this.ttsPlayPauseBtn) {
            this.ttsPlayPauseBtn.addEventListener('click', this.handleTTSPlayPause.bind(this));
        }
        if (this.ttsStopBtn) {
            this.ttsStopBtn.addEventListener('click', this.handleTTSStop.bind(this));
        }
        if (this.ttsSkipBtn) {
            this.ttsSkipBtn.addEventListener('click', this.handleTTSSkip.bind(this));
        }
        if (this.ttsSpeedSlider) {
            this.ttsSpeedSlider.addEventListener('input', this.handleTTSSpeedChange.bind(this));
        }
        
        // Add keyboard shortcuts for faster interaction
        document.addEventListener('keydown', this.handleKeyboardShortcuts.bind(this));
        
        // Listen for page visibility changes to recheck permissions
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && this.microphonePermission === 'denied') {
                // User returned to tab, recheck permissions in case they changed settings
                setTimeout(() => {
                    this.recheckMicrophonePermission();
                }, 1000);
            }
        });
    }

    // Handle keyboard shortcuts
    handleKeyboardShortcuts(event) {
        // Space bar to toggle listening (when not typing in inputs)
        if (event.code === 'Space' && 
            !event.target.matches('input, textarea') && 
            this.apiKey) {
            event.preventDefault();
            this.toggleListening();
        }
        
        // Escape to stop listening or speaking
        if (event.code === 'Escape') {
            event.preventDefault();
            if (this.isListening) {
                this.stopListening();
            } else if (this.audioManager.isPlaying || this.isSpeaking) {
                this.stopAllAudio();
            }
        }
        
        // R key to quick restart
        if (event.code === 'KeyR' && 
            !event.target.matches('input, textarea') && 
            this.apiKey && 
            this.microphonePermission !== 'denied') {
            event.preventDefault();
            this.quickRestart();
        }
    }

    // Initialize speech recognition
    initializeSpeechRecognition() {
        console.log('Initializing speech recognition...');
        
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            console.error('Speech recognition not supported');
            this.showError('Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        
        // Enhanced settings for better performance
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
        this.recognition.maxAlternatives = 1;
        
        // Add retry mechanism with better state management
        this.retryCount = 0;
        this.maxRetries = 2;
        this.autoRestart = false;
        this.isRestarting = false; // New flag to prevent multiple restarts
        this.recognitionState = 'stopped'; // 'stopped', 'starting', 'running'
        
        console.log('Speech recognition initialized successfully');
        
        this.fullTranscript = '';
        
        this.recognition.onstart = () => {
            console.log('Speech recognition started successfully');
            this.isListening = true;
            this.recognitionState = 'running';
            this.isRestarting = false; // Clear restart flag
            this.updateVoiceUI();
            this.statusText.textContent = 'Listening... Speak now!';
            if (this.liveTranscript) {
                this.liveTranscript.classList.add('listening');
            }
            this.audioVisualizer.classList.add('active');
            this.retryCount = 0; // Reset retry count on successful start
            this.fullTranscript = '';
        };
        
        this.recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';
            
            // Enhanced transcript processing with safety checks
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                
                if (result.length > 0) {
                    const alternative = result[0];
                    
                    // SAFE TRANSCRIPT ACCESS - Key fix for undefined issue
                    let transcript = null;
                    if (alternative && 
                        alternative.transcript !== undefined && 
                        alternative.transcript !== null && 
                        typeof alternative.transcript === 'string' &&
                        alternative.transcript !== 'undefined') {
                        transcript = alternative.transcript;
                    } else {
                        console.warn('Invalid transcript detected, skipping result', i);
                        continue; // Skip this result
                    }
                    
                    if (result.isFinal) {
                        finalTranscript += transcript;
                    } else {
                        interimTranscript += transcript;
                    }
                }
            }
            
            // Accumulate all final transcripts
            if (finalTranscript) {
                this.fullTranscript += (this.fullTranscript ? ' ' : '') + finalTranscript;
            }
            
            // Show both accumulated and interim
            const combinedTranscript = (this.fullTranscript + ' ' + interimTranscript).trim();
            this.currentTranscript = combinedTranscript;
            
            // Update live transcript display
            if (this.liveTranscript) {
                this.liveTranscript.textContent = combinedTranscript || 'Listening...';
            }
            // Do NOT processVoiceInput here; wait for user to stop listening
        };
        
        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            this.recognitionState = 'stopped';
            
            // Handle specific errors
            if (event.error === 'no-speech') {
                this.handleNoSpeechError();
            } else if (event.error === 'not-allowed') {
                this.microphonePermission = 'denied';
                this.showError('Microphone access denied. Please allow microphone access and try again.');
                this.cleanStop();
            } else if (event.error === 'network') {
                this.showError('Network error. Please check your internet connection.');
                this.cleanStop();
            } else if (event.error === 'audio-capture') {
                this.showError('Microphone not accessible. Please check your microphone.');
                this.cleanStop();
            } else if (event.error === 'aborted') {
                // Aborted is normal when stopping, don't restart
                console.log('Speech recognition aborted (normal stop)');
                this.cleanStop();
            } else {
                // For other errors, try restart once
                this.handleGenericError(event.error);
            }
        };
        
        this.recognition.onend = () => {
            console.log('Speech recognition ended');
            this.recognitionState = 'stopped';
            if (this.liveTranscript) {
                this.liveTranscript.classList.remove('listening');
            }
            // Only auto-restart if we're supposed to be listening and not already restarting
            // FIX: Only auto-restart if autoRestart is true (not user stop)
            if (this.autoRestart && !this.isRestarting && this.retryCount < this.maxRetries) {
                this.scheduleRestart('Recognition ended, auto-restarting...');
            } else {
                // Always update UI to show stopped state
                this.cleanStop();
                // Ensure mic button shows correct state
                this.updateVoiceUI();
            }
        };
    }

    // Handle no-speech error with controlled restart
    handleNoSpeechError() {
        if (this.autoRestart && this.retryCount < this.maxRetries && !this.isRestarting) {
            this.retryCount++;
            console.log(`No speech detected, auto-restarting... (attempt ${this.retryCount}/${this.maxRetries})`);
            this.statusText.textContent = `No speech detected, listening again... (${this.retryCount}/${this.maxRetries})`;
            this.scheduleRestart('No speech detected');
        } else {
            this.statusText.textContent = 'No speech detected. Click microphone to try again.';
            this.cleanStop();
        }
    }

    // Handle generic errors with controlled restart
    handleGenericError(errorType) {
        if (this.retryCount < 1 && !this.isRestarting) {
            this.retryCount++;
            console.log('Speech error, attempting restart...', errorType);
            this.scheduleRestart(`Error: ${errorType}`);
        } else {
            this.showError('Speech recognition error: ' + errorType);
            this.cleanStop();
        }
    }

    // Centralized restart scheduling to prevent multiple restarts
    scheduleRestart(reason) {
        if (this.isRestarting) {
            console.log('Restart already in progress, skipping...', reason);
            return;
        }
        
        console.log('Scheduling restart:', reason);
        this.isRestarting = true;
        
        // Clean stop first
        this.cleanStop();
        
        // Schedule restart with delay
        setTimeout(() => {
            if (this.autoRestart && this.isRestarting) {
                console.log('Executing scheduled restart');
                this.controlledRestart();
            }
        }, 500);
    }

    // Controlled restart that prevents infinite loops
    async controlledRestart() {
        if (!this.autoRestart) {
            console.log('Auto-restart disabled, canceling restart');
            this.isRestarting = false;
            return;
        }
        
        if (this.recognitionState === 'running') {
            console.log('Recognition already running, canceling restart');
            this.isRestarting = false;
            return;
        }
        
        console.log('Executing controlled restart');
        this.recognitionState = 'starting';
        
        try {
            await this.internalStartListening();
        } catch (error) {
            console.error('Controlled restart failed:', error);
            this.cleanStop();
        }
    }

    // Clean stop without restart
    cleanStop() {
        this.isListening = false;
        this.recognitionState = 'stopped';
        if (this.liveTranscript) {
            this.liveTranscript.classList.remove('listening');
        }
        if (this.audioVisualizer) {
            this.audioVisualizer.classList.remove('active');
        }
        this.updateVoiceUI();
        if (this.statusText) {
            this.statusText.textContent = this.apiKey ? 'Ready! Click the microphone to start speaking.' : 'Enter your API key to start';
        }
    }

    // Load saved API key from localStorage
    loadSavedApiKey() {
        const savedKey = localStorage.getItem('gemini-api-key');
        if (savedKey) {
            this.geminiKeyInput.value = savedKey;
            this.handleApiKeyInput();
        }
    }

    loadSavedVoicePreference() {
        const savedVoice = localStorage.getItem('selectedVoice');
        if (savedVoice && this.voiceSelect) {
            this.voiceSelect.value = savedVoice;
            if (savedVoice === 'browser') {
                this.useGoogleTTS = false;
            } else {
                this.useGoogleTTS = true;
                this.preferredVoice = savedVoice;
            }
        }
        
        // Load TTS preferences
        const savedLiveTTS = localStorage.getItem('liveTTSEnabled');
        if (savedLiveTTS !== null) {
            this.liveTTSEnabled = savedLiveTTS === 'true';
            if (this.liveTTSToggle) {
                this.liveTTSToggle.checked = this.liveTTSEnabled;
            }
        }
        
        const savedSpeed = localStorage.getItem('ttsSpeed');
        if (savedSpeed && this.ttsSpeedSlider) {
            this.ttsSpeed = parseFloat(savedSpeed);
            this.ttsSpeedSlider.value = this.ttsSpeed;
            if (this.ttsSpeedValue) {
                this.ttsSpeedValue.textContent = this.ttsSpeed + 'x';
            }
        }
    }

    // Handle API key input changes
    handleApiKeyInput() {
        this.apiKey = this.geminiKeyInput.value.trim();
        
        if (this.apiKey) {
            localStorage.setItem('gemini-api-key', this.apiKey);
            this.enableControls();
            this.updateMicrophoneStatus(); // Use permission-aware status
        } else {
            localStorage.removeItem('gemini-api-key');
            this.disableControls();
            this.statusText.textContent = 'Enter your API key to start';
        }
    }

    // Toggle API key visibility
    toggleKeyVisibility() {
        const isPassword = this.geminiKeyInput.type === 'password';
        this.geminiKeyInput.type = isPassword ? 'text' : 'password';
        this.toggleKeyBtn.innerHTML = isPassword ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
    }

    // Enable controls when API key is present
    enableControls() {
        this.micButton.disabled = false;
        this.textInput.disabled = false;
        this.sendButton.disabled = false;
    }

    // Disable controls when no API key
    disableControls() {
        this.micButton.disabled = true;
        this.textInput.disabled = true;
        this.sendButton.disabled = true;
        this.cleanStop();
    }

    // Toggle listening state
    async toggleListening() {
        if (!this.apiKey) {
            this.showError('Please enter your Gemini API key first.');
            return;
        }

        if (this.isListening) {
            this.stopListening();
        } else {
            // Quick double-click detection for restart
            const now = Date.now();
            if (this.lastClickTime && (now - this.lastClickTime) < 500) {
                console.log('Double-click detected, performing quick restart');
                await this.quickRestart();
            } else {
                await this.startListening();
            }
            this.lastClickTime = now;
        }
    }

    // Start listening for speech
    async startListening() {
        console.log('User initiated speech recognition start');
        
        // Reset state for user-initiated start
        this.retryCount = 0;
        this.isRestarting = false;
        this.autoRestart = true;
        
        this.fullTranscript = '';
        
        await this.internalStartListening();
    }

    // Internal start method used by both user action and auto-restart
    async internalStartListening() {
        console.log('Internal start listening called, state:', this.recognitionState);
        
        if (!this.recognition) {
            console.error('Speech recognition object not available');
            this.showError('Speech recognition is not available.');
            return;
        }

        // Prevent multiple simultaneous starts
        if (this.recognitionState === 'running') {
            console.log('Recognition already running, ignoring start request');
            return;
        }
        
        if (this.recognitionState === 'starting') {
            console.log('Recognition already starting, ignoring start request');
            return;
        }

        // Check microphone permission
        if (this.microphonePermission === 'denied') {
            this.showError('Microphone access is denied. Please enable microphone access in your browser settings and refresh the page.');
            return;
        }
        
        if (this.microphonePermission === 'unknown' || this.microphonePermission === 'prompt') {
            console.log('Requesting microphone permission first...');
            const permissionGranted = await this.requestMicrophonePermission();
            if (!permissionGranted) {
                return; // Permission denied, error already shown
            }
        }

        try {
            this.recognitionState = 'starting';
            this.currentTranscript = '';
            
            if (this.liveTranscript) {
                this.liveTranscript.textContent = 'Starting...';
            }
            
            console.log('Calling recognition.start()');
            this.recognition.start();
            
        } catch (error) {
            console.error('Error starting speech recognition:', error);
            this.recognitionState = 'stopped';
            
            if (error.name === 'InvalidStateError') {
                console.log('InvalidStateError - recognition may already be running');
                // Don't restart automatically on InvalidStateError to prevent loops
                this.showError('Speech recognition is busy. Please try again in a moment.');
            } else {
                this.showError('Failed to start speech recognition: ' + error.message);
            }
            
            this.cleanStop();
        }
    }

    // Stop listening for speech
    stopListening() {
        console.log('User initiated stop listening');
        this.autoRestart = false; // Disable auto-restart
        this.isRestarting = false; // Stop any pending restarts
        if (this.recognition && (this.isListening || this.recognitionState === 'running' || this.recognitionState === 'starting')) {
            try {
                console.log('Stopping speech recognition');
                this.recognition.stop();
            } catch (error) {
                console.warn('Error stopping recognition:', error);
            }
        }
        // Use cleanStop for consistent state management
        this.cleanStop();
        // After stopping, process the accumulated full transcript if available
        if (this.fullTranscript && this.fullTranscript.trim() && this.fullTranscript !== 'undefined') {
            this.processVoiceInput(this.fullTranscript.trim());
        }
        // Ensure mic button shows correct state
        this.updateVoiceUI();
    }

    // Update voice UI based on listening state
    updateVoiceUI() {
        if (this.isListening) {
            this.micButton.classList.add('recording');
            this.micButton.classList.remove('processing');
            this.micButton.innerHTML = '<i class="fas fa-stop"></i><span class="mic-text">Stop listening</span>';
        } else {
            this.micButton.classList.remove('recording', 'processing');
            this.micButton.innerHTML = '<i class="fas fa-microphone"></i><span class="mic-text">Click to speak</span>';
        }
        
        // Update micText reference after changing innerHTML
        this.micText = this.micButton.querySelector('.mic-text');
    }

    // Quick restart for better UX
    async quickRestart() {
        console.log('Quick restart initiated by user');
        
        // Clean stop first
        this.stopListening();
        
        // Wait a bit for clean stop
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Only restart if we have permission
        if (this.microphonePermission !== 'denied') {
            await this.startListening();
        }
    }

    // Process voice input with enhanced validation
    async processVoiceInput(transcript) {
        console.log('Processing voice input:', transcript);
        
        // Enhanced validation to prevent undefined/invalid transcripts
        if (!transcript || 
            transcript.trim() === '' || 
            transcript === 'undefined' ||
            typeof transcript !== 'string') {
            console.log('Invalid transcript, ignoring...');
            return;
        }
        
        const cleanTranscript = transcript.trim();
        
        // Stop listening after getting valid input
        this.cleanStop();
        this.addUserMessage(cleanTranscript);
        
        // Update live transcript display
        if (this.liveTranscript) {
            this.liveTranscript.textContent = cleanTranscript;
        }
        
        // Clear current transcript for next input
        this.currentTranscript = '';
        
        // Get AI response
        await this.getGeminiResponse(cleanTranscript);
    }

    // Handle text input keypress
    handleTextInputKeypress(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendTextMessage();
        }
    }

    // Send text message
    sendTextMessage() {
        const message = this.textInput.value.trim();
        if (!message) return;
        
        if (!this.apiKey) {
            this.showError('Please enter your Gemini API key first.');
            return;
        }
        
        this.addUserMessage(message);
        this.textInput.value = '';
        this.getGeminiResponse(message);
    }

    // Add user message to chat using iOS-style chat bubbles
    addUserMessage(message) {
        console.log('Adding user message:', message);
        
        if (!message) {
            console.error('Cannot add empty message');
            return;
        }
        
        if (!this.chatContainer) {
            console.error('Chat container not found');
            return;
        }
        
        // Create user message bubble
        const messageElement = document.createElement('div');
        messageElement.className = 'message user-message';
        messageElement.innerHTML = `<div class="message-content">${this.escapeHtml(message)}</div>`;
        
        this.chatContainer.appendChild(messageElement);
        this.scrollToBottom();
        
        this.conversationHistory.push({
            role: 'user',
            parts: [{ text: message }]
        });
        
        // Store this as the start of a new conversation pair
        this.currentConversationIndex = this.conversationPairs.length;
        this.conversationPairs.push({
            question: message,
            questionElement: messageElement,
            answer: null,
            answerElement: null
        });
        
        // Hide all previous conversations when starting a new one
        this.showOnlyCurrentConversation();
        this.updateNavigationButtons();
        console.log('User message added successfully');
        return messageElement;
    }

    // Create AI message element for streaming
    createAIMessageElement() {
        const messageElement = document.createElement('div');
        messageElement.className = 'message ai-message';
        messageElement.innerHTML = `
            <div class="ai-avatar"><i class="fas fa-robot"></i></div>
            <div class="message-content">
                <p></p>
                <button class="speak-btn" title="Speak response" style="display: none;">
                    <i class="fas fa-volume-up"></i>
                </button>
            </div>
        `;
        
        this.chatContainer.appendChild(messageElement);
        this.scrollToBottom();
        
        return messageElement;
    }

    // Add AI message to chat (for non-streaming responses)
    addAIMessage(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message ai-message';
        messageElement.innerHTML = `
            <div class="ai-avatar"><i class="fas fa-robot"></i></div>
            <div class="message-content">
                <p>${this.formatAIResponse(message)}</p>
                <button class="speak-btn" title="Speak response">
                    <i class="fas fa-volume-up"></i>
                </button>
            </div>
        `;
        
        // Add speak button event listener
        const speakBtn = messageElement.querySelector('.speak-btn');
        speakBtn.addEventListener('click', () => {
            this.handleSpeakClick(speakBtn, message);
        });
        
        this.chatContainer.appendChild(messageElement);
        this.scrollToBottom();
        
        // Complete the current conversation pair
        if (this.conversationPairs.length > 0) {
            const currentPair = this.conversationPairs[this.conversationPairs.length - 1];
            currentPair.answer = message;
            currentPair.answerElement = messageElement;
        }
        
        // Ensure only current conversation is visible
        this.showOnlyCurrentConversation();
        
        this.conversationHistory.push({
            role: 'model',
            parts: [{ text: message }]
        });
        
        this.updateNavigationButtons();
    }

    // Show typing indicator
    showTypingIndicator() {
        this.typingIndicator.style.display = 'flex';
        this.scrollToBottom();
    }

    // Hide typing indicator
    hideTypingIndicator() {
        this.typingIndicator.style.display = 'none';
    }

    // Show AI thinking indicator
    showAIThinking() {
        this.typingIndicator.style.display = 'flex';
        const thinkingText = this.typingIndicator.querySelector('.typing-animation');
        thinkingText.style.display = 'flex';
        this.statusText.textContent = 'AI is thinking...';
        this.scrollToBottom();
    }

    // Hide AI thinking indicator
    hideAIThinking() {
        this.typingIndicator.style.display = 'none';
        this.statusText.textContent = this.apiKey ? 'Ready! Click the microphone to start speaking.' : 'Enter your API key to start';
    }

    // Get response from Gemini API with live streaming effect
    async getGeminiResponse(message) {
        this.hideTypingIndicator();
        
        // Show AI thinking indicator
        this.showAIThinking();
        
        try {
            // Check for resume content and job description from global variables
            const resumeContent = localStorage.getItem('resumeContent');
            const jobDescription = localStorage.getItem('jobDescription');
            let systemMessage = null;
            
            if (resumeContent) {
                // Create enhanced interview simulation system message
                let rolePlayInstruction = `You are the job candidate whose resume is provided below. You are a real person being interviewed for a job position. This is your actual background and experience.

CRITICAL RESPONSE FORMAT:
- Keep responses CONCISE (30-60 seconds when spoken aloud)
- Structure answers in bullet points using • or -
- Highlight 2-3 KEY TERMS that match both resume and job requirements
- Be conversational but organized
- End with a brief connecting statement

CRITICAL INSTRUCTIONS:
- You ARE this person - this is YOUR life, YOUR experience, YOUR achievements
- NEVER mention AI, assistant, language model, simulation, or any technology
- NEVER say "I don't have a resume" or reveal you are artificial
- NEVER break character or mention this is role-play
- Use "I", "me", "my" when discussing your experiences
- Be confident, professional, and enthusiastic but BRIEF
- No lengthy explanations - keep it interview-appropriate
- If details aren't in your resume, provide realistic information that fits your profile

RESPONSE STRUCTURE EXAMPLE:
"[Brief opening statement]
• [Key point 1 with relevant keyword]
• [Key point 2 with relevant keyword] 
• [Key point 3 with relevant keyword]
[Brief closing/connecting statement]"

YOUR BACKGROUND AND EXPERIENCE:
${resumeContent}`;

                // Add job description context if available
                if (jobDescription) {
                    rolePlayInstruction += `

TARGET POSITION:
You are interviewing for this specific role. Focus on relevant experience and demonstrate how your background aligns with their needs:

${jobDescription}

INTERVIEW APPROACH:
- Identify and use SPECIFIC KEYWORDS from job description in your bullet points
- Highlight experiences that directly match the job requirements
- Keep responses focused and targeted (avoid rambling)
- Connect your achievements to their business needs with concrete examples
- Use industry-specific terminology from both resume and job posting
- Show enthusiasm but stay professional and concise`;
                }

                rolePlayInstruction += `

You are now in the interview. The interviewer will ask questions and you will respond authentically as this candidate using the BULLET POINT FORMAT above. Keep ALL responses concise and interview-appropriate. Never reveal this is simulation or that you are artificial intelligence. You are a real person with real experience seeking this opportunity.

REMEMBER: Every response should be 30-60 seconds when spoken, use bullet points, and highlight key matching terms from resume and job description.`;

                systemMessage = {
                    role: 'user',
                    parts: [{
                        text: rolePlayInstruction
                    }]
                };
            }
            
            // Prepare conversation contents
            let conversationContents = [];
            
            // Add system message if resume is available
            if (systemMessage) {
                conversationContents.push(systemMessage);
            }
            
            // Add conversation history
            conversationContents.push(...this.conversationHistory);
            
            // Add current user message
            conversationContents.push({
                role: 'user',
                parts: [{ text: message }]
            });

            const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + this.apiKey, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: conversationContents,
                    generationConfig: {
                        temperature: resumeContent ? 0.8 : 0.7, // Higher temp for role-playing
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 1024,
                    }
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error?.message || 'HTTP error! status: ' + response.status);
            }

            const data = await response.json();
            
            if (data.candidates && data.candidates[0] && data.candidates[0].content) {
                const fullResponse = data.candidates[0].content.parts[0].text;
                
                // Hide thinking indicator and create streaming message
                this.hideAIThinking();
                const aiMessageElement = this.createAIMessageElement();
                const messageContent = aiMessageElement.querySelector('.message-content p');
                
                // Stream the response with typewriter effect
                await this.typewriterEffect(messageContent, fullResponse);
                
                // Show and setup speak button after streaming is complete
                const speakBtn = aiMessageElement.querySelector('.speak-btn');
                if (speakBtn) {
                    speakBtn.style.display = 'flex';
                    speakBtn.addEventListener('click', () => {
                        this.handleSpeakClick(speakBtn, fullResponse);
                    });
                }
                
                // Complete the current conversation pair
                if (this.conversationPairs.length > 0) {
                    const currentPair = this.conversationPairs[this.conversationPairs.length - 1];
                    currentPair.answer = fullResponse;
                    currentPair.answerElement = aiMessageElement;
                }
                
                // Ensure only current conversation is visible
                this.showOnlyCurrentConversation();
                
                // Add to conversation history
                this.conversationHistory.push({
                    role: 'model',
                    parts: [{ text: fullResponse }]
                });
                
                this.updateNavigationButtons();
            } else {
                throw new Error('No response content received from Gemini');
            }
            
        } catch (error) {
            console.error('Error getting Gemini response:', error);
            
            // Hide thinking indicator
            this.hideAIThinking();
            
            let errorMessage = 'Failed to get response from Gemini.';
            
            if (error.message.includes('API key')) {
                errorMessage = 'Invalid API key. Please check your Gemini API key.';
            } else if (error.message.includes('quota')) {
                errorMessage = 'API quota exceeded. Please check your Gemini API usage.';
            }
            
            this.showError(errorMessage);
            this.addAIMessage('Sorry, I encountered an error while processing your request. Please try again.');
        }
    }

    // Enhanced typewriter effect for live streaming responses
    async typewriterEffect(element, text) {
        let currentText = '';
        let scrollCounter = 0;
        let speechChunk = '';
        let lastSpeechIndex = 0;
        
        // Show initial cursor with streaming indicator
        element.innerHTML = '<span class="streaming-cursor">▋</span>';
        element.parentElement.classList.add('streaming');
        
        // Scroll once at the beginning to position the message
        this.scrollToBottom();
        
        // For shorter responses, use character-by-character for more responsiveness
        if (text.length < 200) {
            const chars = text.split('');
            
            for (let i = 0; i < chars.length; i++) {
                currentText += chars[i];
                speechChunk += chars[i];
                
                // Update with current text and cursor
                element.innerHTML = this.formatAIResponse(currentText) + '<span class="streaming-cursor">▋</span>';
                
                // Only scroll occasionally to avoid constant movement
                scrollCounter++;
                if (scrollCounter % 10 === 0) { // Every 10 characters
                    this.scrollToBottomIfNeeded(element);
                }
                
                // Queue speech at sentence boundaries or every 50 characters
                if (['.', '!', '?'].includes(chars[i]) || speechChunk.length >= 50) {
                    if (speechChunk.trim()) {
                        this.queueAudioChunk(speechChunk.trim());
                        speechChunk = '';
                    }
                }
                
                // Fast character delay for responsiveness
                const delay = Math.random() * 20 + 15; // 15-35ms delay
                await new Promise(resolve => setTimeout(resolve, delay));
                
                // Pause slightly at punctuation for natural rhythm
                if (['.', '!', '?', ',', ';', ':'].includes(chars[i])) {
                    await new Promise(resolve => setTimeout(resolve, 150));
                }
            }
        } else {
            // For longer responses, use word-by-word streaming with live TTS
            const words = text.split(' ');
            let sentenceWords = [];
            
            for (let i = 0; i < words.length; i++) {
                currentText += (i > 0 ? ' ' : '') + words[i];
                sentenceWords.push(words[i]);
                
                // Update with current text and cursor
                element.innerHTML = this.formatAIResponse(currentText) + '<span class="streaming-cursor">▋</span>';
                
                // Only scroll occasionally to avoid constant movement
                scrollCounter++;
                if (scrollCounter % 5 === 0) { // Every 5 words
                    this.scrollToBottomIfNeeded(element);
                }
                
                // Check if we've reached a sentence boundary or accumulated enough words
                const isEndOfSentence = words[i].includes('.') || words[i].includes('!') || words[i].includes('?');
                const isLongChunk = sentenceWords.length >= 15; // ~15 words = good chunk size
                
                if (isEndOfSentence || isLongChunk) {
                    const chunk = sentenceWords.join(' ');
                    if (chunk.trim()) {
                        this.queueAudioChunk(chunk.trim());
                        sentenceWords = [];
                    }
                }
                
                // Variable delay based on word length for natural feel
                const wordLength = words[i].length;
                const baseDelay = Math.min(wordLength * 10, 80);
                const randomDelay = Math.random() * 40 + 20;
                const delay = baseDelay + randomDelay; // 20-120ms delay
                
                await new Promise(resolve => setTimeout(resolve, delay));
                
                // Longer pause at sentence endings
                if (isEndOfSentence) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                    // Scroll after sentences for better readability
                    this.scrollToBottomIfNeeded(element);
                }
            }
            
            // Queue any remaining words
            if (sentenceWords.length > 0) {
                const chunk = sentenceWords.join(' ');
                if (chunk.trim()) {
                    this.queueAudioChunk(chunk.trim());
                }
            }
        }
        
        // Queue any remaining speech chunk
        if (speechChunk.trim()) {
            this.queueAudioChunk(speechChunk.trim());
        }
        
        // Remove cursor and streaming indicator, show final text
        element.innerHTML = this.formatAIResponse(currentText);
        element.parentElement.classList.remove('streaming');
        
        // Final scroll to ensure everything is visible
        this.scrollToBottom();
        
        // Brief highlight effect to show completion
        element.parentElement.classList.add('stream-complete');
        setTimeout(() => {
            element.parentElement.classList.remove('stream-complete');
        }, 1000);
    }

    // Smart scroll that only scrolls if the element is near the bottom
    scrollToBottomIfNeeded(element) {
        const chatContainer = this.chatContainer;
        const containerHeight = chatContainer.clientHeight;
        const scrollTop = chatContainer.scrollTop;
        const scrollHeight = chatContainer.scrollHeight;
        
        // Only scroll if user is already near the bottom (within 100px)
        const nearBottom = scrollHeight - scrollTop - containerHeight < 100;
        
        if (nearBottom) {
            chatContainer.scrollTop = scrollHeight;
        }
    }

    // Navigation methods
    showPreviousConversation() {
        if (this.currentConversationIndex > 0) {
            // Stop any ongoing speech when navigating
            this.stopSpeaking();
            this.currentConversationIndex--;
            this.showOnlyCurrentConversation();
            this.updateNavigationButtons();
        }
    }

    showNextConversation() {
        if (this.currentConversationIndex < this.conversationPairs.length - 1) {
            // Stop any ongoing speech when navigating
            this.stopSpeaking();
            this.currentConversationIndex++;
            this.showOnlyCurrentConversation();
            this.updateNavigationButtons();
        }
    }

    hideAllConversations() {
        this.conversationPairs.forEach(pair => {
            if (pair.questionElement) {
                pair.questionElement.style.display = 'none';
                pair.questionElement.style.opacity = '0';
            }
            if (pair.answerElement) {
                pair.answerElement.style.display = 'none';
                pair.answerElement.style.opacity = '0';
            }
        });
    }

    showConversationAtIndex(index) {
        if (index >= 0 && index < this.conversationPairs.length) {
            const pair = this.conversationPairs[index];
            if (pair.questionElement) {
                pair.questionElement.style.display = 'flex';
                // Smooth fade in
                setTimeout(() => {
                    pair.questionElement.style.opacity = '1';
                }, 10);
            }
            if (pair.answerElement) {
                pair.answerElement.style.display = 'flex';
                // Smooth fade in
                setTimeout(() => {
                    pair.answerElement.style.opacity = '1';
                }, 10);
            }
            
            // Scroll to top of current conversation
            this.scrollToBottom();
        }
    }

    showOnlyCurrentConversation() {
        // Hide welcome message if we have conversations
        const welcomeMessage = document.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.style.display = this.conversationPairs.length > 0 ? 'none' : 'flex';
        }
        
        // Hide all conversations first
        this.hideAllConversations();
        // Show only the current one
        this.showConversationAtIndex(this.currentConversationIndex);
    }

    initializeConversationView() {
        // Start with a clean view - only show current conversation if any exist
        if (this.conversationPairs.length > 0) {
            this.showOnlyCurrentConversation();
        } else {
            // Show welcome message if no conversations
            const welcomeMessage = document.querySelector('.welcome-message');
            if (welcomeMessage) {
                welcomeMessage.style.display = 'flex';
            }
        }
        this.updateNavigationButtons();
    }

    updateNavigationButtons() {
        if (!this.prevBtn || !this.nextBtn) return;
        
        const navControls = document.querySelector('.nav-controls');
        const counter = document.querySelector('.conversation-counter');
        
        if (this.conversationPairs.length > 0) {
            // Show navigation controls
            if (navControls) navControls.style.display = 'flex';
            
            // Update button states
            this.prevBtn.disabled = this.currentConversationIndex <= 0;
            this.nextBtn.disabled = this.currentConversationIndex >= this.conversationPairs.length - 1;
            
            // Add/update conversation counter
            if (counter) {
                counter.textContent = `${this.currentConversationIndex + 1} / ${this.conversationPairs.length}`;
            } else {
                const newCounter = document.createElement('div');
                newCounter.className = 'conversation-counter';
                newCounter.textContent = `${this.currentConversationIndex + 1} / ${this.conversationPairs.length}`;
                navControls.parentNode.insertBefore(newCounter, navControls.nextSibling);
            }
        } else {
            // Hide navigation controls when no conversations
            if (navControls) navControls.style.display = 'none';
            if (counter) counter.remove();
        }
    }

    // Clear conversation
    clearConversation() {
        // Stop any ongoing speech
        this.stopSpeaking();
        
        const messages = this.chatContainer.querySelectorAll('.message:not(.welcome-message)');
        messages.forEach(message => message.remove());
        
        this.conversationHistory = [];
        this.conversationPairs = [];
        this.currentConversationIndex = 0;
        this.currentTranscript = '';
        this.liveTranscript.textContent = 'Your speech will appear here in real-time...';
        this.hideTypingIndicator();
        this.updateNavigationButtons();
        
        // Remove conversation counter
        const counter = document.querySelector('.conversation-counter');
        if (counter) counter.remove();
        
        // Show welcome message again
        const welcomeMessage = document.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.style.display = 'flex';
        }
    }

    // Text-to-Speech functionality
    async speakText(text, button = null) {
        try {
            // Stop any current speech
            this.stopSpeaking();
            
            if (!text || text.trim() === '') {
                this.showError('No text to speak.');
                return;
            }
            
            // Try Google Cloud TTS first
            if (this.useGoogleTTS) {
                try {
                    console.log('Using Google Cloud TTS...');
                    const audioContent = await this.synthesizeWithGoogleTTS(text);
                    this.playAudioFromBase64(audioContent, button);
                    return;
                } catch (error) {
                    console.error('Google TTS failed, falling back to browser TTS:', error);
                    this.useGoogleTTS = false; // Disable for subsequent calls
                }
            }
            
            // Fallback to browser TTS
            console.log('Using browser TTS fallback...');
            if (!this.speechSynthesis) {
                this.showError('Text-to-speech is not supported in your browser.');
                return;
            }
            
            // Clean and optimize text for natural speech
            const cleanText = this.cleanTextForTTS(text);
            
            if (!cleanText) {
                this.showError('No text to speak.');
                return;
            }
            
            this.currentUtterance = new SpeechSynthesisUtterance(cleanText);
            
            // Configure voice settings for more natural speech
            this.currentUtterance.rate = 0.8; // Even slower for conversational pace
            this.currentUtterance.pitch = 0.9; // Lower pitch for warmth and authority
            this.currentUtterance.volume = 0.9;
            
            // Adjust settings based on content length and type
            const wordCount = cleanText.split(' ').length;
            if (wordCount > 100) {
                // For longer responses, speak a bit faster to maintain engagement
                this.currentUtterance.rate = 0.85;
            } else if (wordCount < 20) {
                // For shorter responses, speak more deliberately
                this.currentUtterance.rate = 0.75;
            }
            
            // Try to find the most natural voice available
            const voices = this.speechSynthesis.getVoices();
            const preferredVoice = this.findBestVoice(voices);
            
            if (preferredVoice) {
                this.currentUtterance.voice = preferredVoice;
            }
            
            // Event handlers
            this.currentUtterance.onstart = () => {
                this.isSpeaking = true;
                if (button) {
                    button.classList.add('speaking');
                    button.querySelector('i').className = 'fas fa-pause';
                    button.title = 'Stop speaking';
                }
            };
            
            this.currentUtterance.onend = () => {
                this.isSpeaking = false;
                if (button) {
                    button.classList.remove('speaking');
                    button.querySelector('i').className = 'fas fa-volume-up';
                    button.title = 'Speak response';
                }
                this.currentUtterance = null;
            };
            
            this.currentUtterance.onerror = (event) => {
                console.error('Speech synthesis error:', event);
                this.isSpeaking = false;
                if (button) {
                    button.classList.remove('speaking');
                    button.querySelector('i').className = 'fas fa-volume-up';
                    button.title = 'Speak response';
                }
                this.currentUtterance = null;
                this.showError('Failed to speak text: ' + event.error);
            };
            
            // Start speaking
            this.speechSynthesis.speak(this.currentUtterance);
            
        } catch (error) {
            console.error('Text-to-speech error:', error);
            this.showError('Text-to-speech failed: ' + error.message);
        }
    }
    
    stopSpeaking() {
        if (this.isSpeaking) {
            // Stop Google Cloud TTS audio
            const audioElements = document.querySelectorAll('audio');
            audioElements.forEach(audio => {
                if (!audio.paused) {
                    audio.pause();
                    audio.currentTime = 0;
                }
            });
            
            // Stop browser TTS
            if (this.speechSynthesis) {
                this.speechSynthesis.cancel();
            }
            
            this.isSpeaking = false;
            
            // Reset all speak buttons
            const speakButtons = document.querySelectorAll('.speak-btn');
            speakButtons.forEach(btn => {
                btn.classList.remove('speaking');
                btn.querySelector('i').className = 'fas fa-volume-up';
                btn.title = 'Speak response';
            });
            
            this.currentUtterance = null;
        }
    }
    
    handleSpeakClick(button, text) {
        if (this.isSpeaking && this.currentUtterance) {
            // If currently speaking, stop
            this.stopSpeaking();
        } else {
            // If not speaking, start
            this.speakText(text, button);
        }
    }

    // Handle voice selection change
    handleVoiceSelection(event) {
        const selectedVoice = event.target.value;
        
        if (selectedVoice === 'browser') {
            this.useGoogleTTS = false;
            console.log('Switched to browser TTS');
        } else {
            this.useGoogleTTS = true;
            this.preferredVoice = selectedVoice;
            console.log('Switched to Google Cloud TTS voice:', selectedVoice);
        }
        
        // Save preference to localStorage
        localStorage.setItem('selectedVoice', selectedVoice);
    }

    // FIXED: Handle live TTS toggle
    handleLiveTTSToggle(event) {
        console.log('===== Live TTS Toggle Triggered =====');
        console.log('Event:', event);
        console.log('Event target:', event.target);
        console.log('Checkbox checked state:', event.target.checked);
        console.log('Previous internal state:', this.liveTTSEnabled);
        
        this.liveTTSEnabled = event.target.checked;
        console.log('New internal state:', this.liveTTSEnabled);
        
        if (!this.liveTTSEnabled) {
            console.log('Stopping all audio due to live TTS disable');
            this.stopAllAudio();
        }
        
        // FIXED: Use the helper method for consistent visual updates
        this.updateToggleVisualState();
        
        // Add active feedback animation
        const toggleSlider = document.querySelector('.toggle-slider');
        if (toggleSlider) {
            toggleSlider.classList.add('toggle-active');
            setTimeout(() => {
                toggleSlider.classList.remove('toggle-active');
            }, 200);
        }
        
        // Ensure checkbox state is synchronized
        const checkbox = document.getElementById('live-tts-toggle');
        if (checkbox && checkbox.checked !== this.liveTTSEnabled) {
            console.log('Synchronizing checkbox state');
            checkbox.checked = this.liveTTSEnabled;
        }
        
        // Save preference
        localStorage.setItem('liveTTSEnabled', this.liveTTSEnabled);
        console.log('Live TTS preference saved to localStorage:', this.liveTTSEnabled);
        
        // Show user feedback with better styling
        const statusText = this.liveTTSEnabled ? '🔊 Live speaking enabled' : '🔇 Live speaking disabled';
        console.log('Status message:', statusText);
        
        // Enhanced visual feedback
        if (this.statusText) {
            const originalText = this.statusText.textContent;
            this.statusText.textContent = statusText;
            this.statusText.style.color = this.liveTTSEnabled ? '#007AFF' : '#666';
            this.statusText.style.fontWeight = '600';
            
            setTimeout(() => {
                this.statusText.textContent = originalText;
                this.statusText.style.color = '';
                this.statusText.style.fontWeight = '';
            }, 2000);
        }
        
        console.log('===== Toggle Handler Complete =====');
    }

    // Reset toggle button to clean state
    resetToggleButton() {
        const toggleSlider = document.querySelector('.toggle-slider');
        const checkbox = document.getElementById('live-tts-toggle');
        const ttsToggle = document.querySelector('.tts-toggle');
        
        if (toggleSlider && checkbox && ttsToggle) {
            console.log('Resetting toggle button...');
            
            // Clear all inline styles
            toggleSlider.style.backgroundColor = '';
            
            // Remove all classes
            toggleSlider.classList.remove('toggle-on', 'toggle-off', 'toggle-active', 'clicked');
            ttsToggle.classList.remove('enabled', 'disabled');
            
            // Reset to default state (enabled)
            this.liveTTSEnabled = true;
            checkbox.checked = true;
            
            // Apply clean visual state
            this.updateToggleVisualState();
            
            // Save to localStorage
            localStorage.setItem('liveTTSEnabled', 'true');
            
            console.log('Toggle button reset complete');
        }
    }

    // Debug method to test toggle state
    debugToggleState() {
        console.log('=== DEBUG TOGGLE STATE ===');
        const checkbox = document.getElementById('live-tts-toggle');
        const toggleSlider = document.querySelector('.toggle-slider');
        const ttsToggle = document.querySelector('.tts-toggle');
        
        console.log('Internal state:', this.liveTTSEnabled);
        console.log('Checkbox checked:', checkbox ? checkbox.checked : 'NOT FOUND');
        console.log('Toggle slider element:', toggleSlider ? 'FOUND' : 'NOT FOUND');
        console.log('Toggle slider classes:', toggleSlider ? toggleSlider.classList.toString() : 'N/A');
        console.log('Toggle slider background:', toggleSlider ? toggleSlider.style.backgroundColor : 'N/A');
        console.log('TTS toggle classes:', ttsToggle ? ttsToggle.classList.toString() : 'N/A');
        
        if (toggleSlider) {
            const computedStyle = window.getComputedStyle(toggleSlider);
            console.log('Computed background:', computedStyle.backgroundColor);
            
            const beforeStyle = window.getComputedStyle(toggleSlider, '::before');
            console.log('Before element transform:', beforeStyle.transform);
        }
        
        // Force visual update
        this.updateToggleVisualState();
        console.log('=== DEBUG COMPLETE ===');
    }

    // Force toggle visual state (direct DOM manipulation)
    forceToggleVisualState(state) {
        const toggleSlider = document.querySelector('.toggle-slider');
        const checkbox = document.getElementById('live-tts-toggle');
        
        if (toggleSlider && checkbox) {
            // Set internal state
            this.liveTTSEnabled = state;
            checkbox.checked = state;
            
            // Remove all toggle classes first
            toggleSlider.classList.remove('toggle-on', 'toggle-off');
            
            // Add appropriate class and style
            if (state) {
                toggleSlider.classList.add('toggle-on');
                toggleSlider.style.backgroundColor = '#007AFF';
            } else {
                toggleSlider.classList.add('toggle-off');
                toggleSlider.style.backgroundColor = '#ccc';
            }
            
            // Force browser reflow
            toggleSlider.offsetHeight;
            
            console.log('Forced toggle state to:', state);
            console.log('Visual classes:', toggleSlider.classList.toString());
            console.log('Background color:', toggleSlider.style.backgroundColor);
        }
    }

    // Handle TTS play/pause
    handleTTSPlayPause() {
        if (this.audioManager.playbackState === 'playing') {
            this.pauseAudio();
        } else if (this.audioManager.playbackState === 'paused') {
            this.resumeAudio();
        } else {
            // If stopped, restart from current conversation
            this.restartCurrentConversationAudio();
        }
    }

    // Handle TTS stop
    handleTTSStop() {
        this.stopAllAudio();
        this.updateTTSControls();
    }

    // Handle TTS skip to end
    handleTTSSkip() {
        this.skipToEnd();
    }

    // Handle TTS speed change
    handleTTSSpeedChange(event) {
        this.ttsSpeed = parseFloat(event.target.value);
        this.ttsSpeedValue.textContent = this.ttsSpeed + 'x';
        
        // Apply speed to current audio if playing
        if (this.audioManager.currentAudio && !this.audioManager.currentAudio.paused) {
            this.audioManager.currentAudio.playbackRate = this.ttsSpeed;
        }
        
        // Save preference
        localStorage.setItem('ttsSpeed', this.ttsSpeed);
    }

    // Find the best, most natural voice available
    findBestVoice(voices) {
        if (!voices || voices.length === 0) {
            return null;
        }

        // Priority order for natural voices (highest to lowest quality)
        const voicePriorities = [
            // Premium/Neural voices (highest quality)
            /neural|premium|enhanced|natural|eloquence/i,
            
            // Platform-specific high-quality voices
            /samantha|alex|victoria|karen|daniel|fiona|moira|tessa/i, // macOS voices
            /zira|david|mark|hazel/i, // Windows voices
            /google\s*(us|uk)|chrome/i, // Google voices
            
            // Gender preference for warmer sound
            /female|woman|girl/i,
            
            // Avoid obviously robotic voices
            /(?!.*robot|microsoft|anna|paulina)/i
        ];

        // Filter to English voices only
        const englishVoices = voices.filter(voice => 
            voice.lang && (
                voice.lang.toLowerCase().startsWith('en-') || 
                voice.lang.toLowerCase() === 'en'
            )
        );

        // Try each priority level
        for (const priority of voicePriorities) {
            const matchingVoices = englishVoices.filter(voice => 
                priority.test(voice.name)
            );
            
            if (matchingVoices.length > 0) {
                console.log('Selected voice:', matchingVoices[0].name, 'Lang:', matchingVoices[0].lang);
                return matchingVoices[0];
            }
        }

        // Fallback: prefer local voices over remote, and female over male for warmth
        const localVoices = englishVoices.filter(voice => voice.localService);
        if (localVoices.length > 0) {
            // Try to find a female voice for warmer tone
            const femaleVoice = localVoices.find(voice => 
                /female|woman|girl|samantha|victoria|karen|fiona|moira|tessa|zira|hazel/i.test(voice.name)
            );
            if (femaleVoice) {
                console.log('Selected fallback female voice:', femaleVoice.name);
                return femaleVoice;
            }
            console.log('Selected fallback local voice:', localVoices[0].name);
            return localVoices[0];
        }

        // Last resort: any English voice
        if (englishVoices.length > 0) {
            console.log('Selected last resort voice:', englishVoices[0].name);
            return englishVoices[0];
        }

        // Ultimate fallback: any voice
        console.log('Using ultimate fallback voice:', voices[0]?.name || 'default');
        return voices[0] || null;
    }

    // Scroll chat to bottom
    scrollToBottom() {
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    // Show error message with permission help
    showError(message) {
        console.error('Error:', message);
        
        // Add helpful guidance for permission errors
        if (message.includes('Microphone access denied') || message.includes('denied')) {
            message += '\n\n💡 To fix this:\n1. Click the 🔒 lock icon in your browser address bar\n2. Set Microphone to "Allow"\n3. Refresh this page';
        }
        
        if (this.errorMessage && this.errorToast) {
            this.errorMessage.textContent = message;
            this.errorToast.style.display = 'flex';
            
            setTimeout(() => {
                this.hideError();
            }, 8000); // Longer timeout for permission instructions
        } else {
            // Fallback if error elements not found
            alert('Error: ' + message);
        }
    }

    // Hide error message
    hideError() {
        if (this.errorToast) {
            this.errorToast.style.display = 'none';
        }
    }

    // Escape HTML
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Format AI response with basic markdown
    formatAIResponse(text) {
        let formatted = this.escapeHtml(text);
        
        formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
        formatted = formatted.replace(/`(.*?)`/g, '<code>$1</code>');
        formatted = formatted.replace(/\n/g, '<br>');
        
        return formatted;
    }

    // Check microphone permission status
    async checkMicrophonePermission() {
        console.log('Checking microphone permission...');
        
        try {
            // First check if permissions API is available
            if ('permissions' in navigator) {
                const permission = await navigator.permissions.query({ name: 'microphone' });
                this.microphonePermission = permission.state;
                console.log('Permission state from API:', permission.state);
                
                // Listen for permission changes
                permission.onchange = () => {
                    this.microphonePermission = permission.state;
                    console.log('Permission changed to:', permission.state);
                    this.updateMicrophoneStatus();
                };
            } else {
                console.log('Permissions API not available, will check on first use');
            }
            
            this.permissionChecked = true;
            this.updateMicrophoneStatus();
            
        } catch (error) {
            console.log('Could not check microphone permission:', error);
            this.permissionChecked = true;
        }
    }

    // Update UI based on microphone permission status
    updateMicrophoneStatus() {
        if (!this.apiKey) return;
        
        if (this.microphonePermission === 'denied') {
            this.statusText.textContent = 'Microphone access denied. Please enable in browser settings.';
            this.micButton.disabled = true;
            this.micButton.classList.add('permission-denied');
        } else if (this.microphonePermission === 'granted') {
            this.statusText.textContent = 'Ready! Click the microphone to start speaking.';
            this.micButton.disabled = false;
            this.micButton.classList.remove('permission-denied');
        } else {
            this.statusText.textContent = 'Ready! Click the microphone to start speaking.';
            this.micButton.disabled = false;
            this.micButton.classList.remove('permission-denied');
        }
    }

    // Request microphone permission only when needed
    async requestMicrophonePermission() {
        console.log('Requesting microphone permission...');
        
        try {
            // Try to get media stream to trigger permission request
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            // Permission granted
            this.microphonePermission = 'granted';
            console.log('Microphone permission granted');
            
            // Stop the stream immediately (we just needed permission)
            stream.getTracks().forEach(track => track.stop());
            
            this.updateMicrophoneStatus();
            return true;
            
        } catch (error) {
            console.error('Microphone permission denied or failed:', error);
            
            if (error.name === 'NotAllowedError') {
                this.microphonePermission = 'denied';
                this.showError('Microphone access denied. Please click the 🔒 lock icon in your browser address bar and allow microphone access.');
            } else if (error.name === 'NotFoundError') {
                this.showError('No microphone found. Please connect a microphone and try again.');
            } else {
                this.showError('Could not access microphone: ' + error.message);
            }
            
            this.updateMicrophoneStatus();
            return false;
        }
    }

    // Help user re-enable microphone permissions
    async recheckMicrophonePermission() {
        console.log('Rechecking microphone permission...');
        await this.checkMicrophonePermission();
        
        if (this.microphonePermission === 'granted') {
            this.statusText.textContent = 'Microphone access restored! Ready to listen.';
            this.micButton.disabled = false;
        } else if (this.microphonePermission === 'denied') {
            this.showError('Microphone access is still denied. Please enable it in your browser settings.');
        }
    }

    // NEW: Browser TTS with enhanced audio management
    async speakWithBrowserTTS(text, button = null, isStreaming = false) {
        return new Promise((resolve, reject) => {
            if (!this.speechSynthesis) {
                reject(new Error('Speech synthesis not supported'));
                return;
            }

            // Stop any existing speech
            this.stopAllAudio();

            // Clean text for TTS
            const cleanText = this.cleanTextForTTS(text);
            
            // Create utterance
            const utterance = new SpeechSynthesisUtterance(cleanText);
            
            // Find and set the best voice
            const voices = this.speechSynthesis.getVoices();
            const bestVoice = this.findBestVoice(voices);
            if (bestVoice) {
                utterance.voice = bestVoice;
            }

            // Set speech parameters
            utterance.rate = this.ttsSpeed;
            utterance.pitch = 0.9;
            utterance.volume = 1.0;

            // Update audio manager
            this.audioManager.isPlaying = true;
            this.audioManager.isPaused = false;
            this.audioManager.currentSpeaker = button;
            this.audioManager.playbackState = 'playing';
            this.currentUtterance = utterance;
            this.isSpeaking = true;

            // Update button state
            if (button) {
                this.updateSpeakButtonState(button, 'playing');
            }

            // Update TTS controls
            this.updateTTSControls();

            // Event listeners
            utterance.onstart = () => {
                console.log('Browser TTS started');
                this.audioManager.playbackState = 'playing';
                this.updateTTSControls();
            };

            utterance.onend = () => {
                console.log('Browser TTS ended');
                this.audioManager.playbackState = 'stopped';
                this.audioManager.isPlaying = false;
                this.audioManager.currentSpeaker = null;
                this.isSpeaking = false;
                this.currentUtterance = null;

                // Update button state
                if (button) {
                    this.updateSpeakButtonState(button, 'stopped');
                }

                // Update TTS controls
                this.updateTTSControls();

                // Play next in queue if available
                if (this.ttsQueue.length > 0 && this.liveTTSEnabled) {
                    setTimeout(() => this.playNextInQueue(), 100);
                }

                resolve();
            };

            utterance.onerror = (event) => {
                console.error('Browser TTS error:', event.error);
                this.audioManager.playbackState = 'stopped';
                this.audioManager.isPlaying = false;
                this.audioManager.currentSpeaker = null;
                this.isSpeaking = false;
                this.currentUtterance = null;

                // Update button state
                if (button) {
                    this.updateSpeakButtonState(button, 'stopped');
                }

                // Update TTS controls
                this.updateTTSControls();

                reject(new Error('Browser TTS error: ' + event.error));
            };

            utterance.onpause = () => {
                console.log('Browser TTS paused');
                this.audioManager.playbackState = 'paused';
                this.updateTTSControls();
            };

            utterance.onresume = () => {
                console.log('Browser TTS resumed');
                this.audioManager.playbackState = 'playing';
                this.updateTTSControls();
            };

            // Start speaking
            this.speechSynthesis.speak(utterance);
        });
    }

    // FIXED: Load saved TTS settings
    loadSavedTTSSettings() {
        // Load live TTS setting
        const savedLiveTTS = localStorage.getItem('liveTTSEnabled');
        if (savedLiveTTS !== null) {
            this.liveTTSEnabled = savedLiveTTS === 'true';
            console.log('Loaded TTS setting from localStorage:', this.liveTTSEnabled);
            if (this.liveTTSToggle) {
                this.liveTTSToggle.checked = this.liveTTSEnabled;
                
                // CRITICAL: Initialize visual state immediately
                setTimeout(() => {
                    this.updateToggleVisualState();
                }, 50);
            }
        } else {
            // Default to enabled if no preference saved
            this.liveTTSEnabled = true;
            console.log('No saved TTS setting found, defaulting to enabled');
            if (this.liveTTSToggle) {
                this.liveTTSToggle.checked = true;
                setTimeout(() => {
                    this.updateToggleVisualState();
                }, 50);
            }
        }
        
        // Load TTS speed
        const savedSpeed = localStorage.getItem('ttsSpeed');
        if (savedSpeed) {
            this.ttsSpeed = parseFloat(savedSpeed);
            if (this.ttsSpeedSlider) {
                this.ttsSpeedSlider.value = this.ttsSpeed;
            }
            if (this.ttsSpeedValue) {
                this.ttsSpeedValue.textContent = this.ttsSpeed + 'x';
            }
        }
        
        console.log('TTS settings loaded:', {
            liveTTSEnabled: this.liveTTSEnabled,
            ttsSpeed: this.ttsSpeed
        });
    }
    
    // NEW: Update toggle visual state helper method
    updateToggleVisualState() {
        const ttsToggle = document.querySelector('.tts-toggle');
        const toggleSlider = document.querySelector('.toggle-slider');
        const checkbox = document.getElementById('live-tts-toggle');
        
        if (ttsToggle && toggleSlider && checkbox) {
            console.log('Updating toggle visual state. Internal state:', this.liveTTSEnabled);
            
            // Ensure checkbox state matches internal state
            checkbox.checked = this.liveTTSEnabled;
            
            // Update container classes
            ttsToggle.classList.toggle('enabled', this.liveTTSEnabled);
            ttsToggle.classList.toggle('disabled', !this.liveTTSEnabled);
            
            // Remove all existing toggle classes
            toggleSlider.classList.remove('toggle-on', 'toggle-off');
            
            // Add the correct class and style based on state
            if (this.liveTTSEnabled) {
                toggleSlider.classList.add('toggle-on');
                toggleSlider.style.backgroundColor = '#007AFF';
                console.log('Set to ON state - blue background');
            } else {
                toggleSlider.classList.add('toggle-off');
                toggleSlider.style.backgroundColor = '#ccc';
                console.log('Set to OFF state - gray background');
            }
            
            // Force a reflow to ensure CSS updates are applied
            toggleSlider.offsetHeight;
            
            // Log the final state for debugging
            console.log('Final toggle state:', {
                enabled: this.liveTTSEnabled,
                checkboxChecked: checkbox.checked,
                sliderBackground: toggleSlider.style.backgroundColor,
                sliderClasses: toggleSlider.classList.toString()
            });
        }
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new VoiceAIAssistant();
    
    // Add some visual feedback for microphone permission
    navigator.permissions?.query({ name: 'microphone' }).then((result) => {
        if (result.state === 'denied') {
            console.warn('Microphone permission denied');
        }
    }).catch(() => {
        // Permissions API not supported, that's okay
    });
});

// Add some utility functions for enhanced UX
function createRippleEffect(event) {
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    const ripple = document.createElement('span');
    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;
    
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    ripple.classList.add('ripple');
    
    button.appendChild(ripple);
    
    setTimeout(() => {
        ripple.remove();
    }, 600);
}

// Add ripple effect to buttons
document.addEventListener('DOMContentLoaded', () => {
    const buttons = document.querySelectorAll('.mic-button, .send-btn');
    buttons.forEach(button => {
        button.addEventListener('click', createRippleEffect);
    });
});

// Global variables
let recognition;
let isRecording = false;
let isProcessing = false;
let micPermissionGranted = false;
let micPermissionDenied = false;
let currentStreamingDiv = null;
let currentStreamingText = '';
let streamingTimeout = null;
let resumeContent = null;
let resumeFileName = null;
let noSpeechCount = 0;
let jobDescription = null;

// PDF.js configuration
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Resume upload elements
const resumeUpload = document.getElementById('resume-upload');
const uploadResumeBtn = document.getElementById('upload-resume-btn');
const resumeStatus = document.getElementById('resume-status');
const resumeFilename = document.getElementById('resume-filename');
const removeResumeBtn = document.getElementById('remove-resume-btn');
const pdfLoading = document.getElementById('pdf-loading');

// Job description elements
const toggleJdBtn = document.getElementById('toggle-jd-btn');
const jdInputContainer = document.getElementById('jd-input-container');
const closeJdBtn = document.getElementById('close-jd-btn');
const jobDescriptionInput = document.getElementById('job-description-input');
const saveJdBtn = document.getElementById('save-jd-btn');
const clearJdBtn = document.getElementById('clear-jd-btn');
const jdStatus = document.getElementById('jd-status');
const jdPreview = document.getElementById('jd-preview');
const editJdBtn = document.getElementById('edit-jd-btn');
const removeJdBtn = document.getElementById('remove-jd-btn');

// Initialize app with class-based approach
document.addEventListener('DOMContentLoaded', function() {
    // Initialize the VoiceAIAssistant class
    window.voiceAI = new VoiceAIAssistant();
    
    // Setup resume upload functionality
    setupResumeUpload();
    
    // Setup job description functionality
    setupJobDescription();
    
    // Load saved data
    loadSavedResumeData();
    loadSavedJobDescription();
});

function setupResumeUpload() {
    // Resume upload event listeners
    uploadResumeBtn.addEventListener('click', () => resumeUpload.click());
    resumeUpload.addEventListener('change', handleResumeUpload);
    removeResumeBtn.addEventListener('click', removeResume);
}

function setupJobDescription() {
    // Job description event listeners
    toggleJdBtn.addEventListener('click', showJobDescriptionInput);
    closeJdBtn.addEventListener('click', hideJobDescriptionInput);
    saveJdBtn.addEventListener('click', saveJobDescription);
    clearJdBtn.addEventListener('click', clearJobDescription);
    editJdBtn.addEventListener('click', showJobDescriptionInput);
    removeJdBtn.addEventListener('click', removeJobDescription);
    
    // Close JD input when clicking outside
    document.addEventListener('click', function(event) {
        if (!event.target.closest('.job-description-section')) {
            hideJobDescriptionInput();
        }
    });
}

function showJobDescriptionInput() {
    jdInputContainer.style.display = 'block';
    jobDescriptionInput.focus();
    
    // If editing, load current content
    if (jobDescription) {
        jobDescriptionInput.value = jobDescription;
    }
}

function hideJobDescriptionInput() {
    jdInputContainer.style.display = 'none';
    jobDescriptionInput.value = '';
}

function saveJobDescription() {
    const jdContent = jobDescriptionInput.value.trim();
    
    if (!jdContent) {
        window.voiceAI.showError('Please enter a job description.');
        return;
    }
    
    // Store job description
    jobDescription = jdContent;
    
    // Update UI
    toggleJdBtn.style.display = 'none';
    jdStatus.style.display = 'flex';
    
    // Create preview (first 50 characters)
    const preview = jdContent.length > 50 ? jdContent.substring(0, 50) + '...' : jdContent;
    jdPreview.textContent = preview;
    
    // Save to localStorage
    localStorage.setItem('jobDescription', jobDescription);
    
    // Hide input
    hideJobDescriptionInput();
    
    // Add confirmation message to chat
    window.voiceAI.addAIMessage('📋 Job description added successfully! I\'ll now tailor my responses to match this specific role and highlight relevant experience from your resume.');
    
    // Update welcome message
    updateWelcomeMessage();
    
    showSuccess('Job description saved successfully!');
}

function clearJobDescription() {
    jobDescriptionInput.value = '';
    jobDescriptionInput.focus();
}

function removeJobDescription() {
    jobDescription = null;
    
    // Update UI
    toggleJdBtn.style.display = 'flex';
    jdStatus.style.display = 'none';
    
    // Remove from localStorage
    localStorage.removeItem('jobDescription');
    
    // Add confirmation message to chat
    window.voiceAI.addAIMessage('📋 Job description removed. I\'ll now provide general interview responses based on your resume.');
    
    // Update welcome message
    updateWelcomeMessage();
    
    showSuccess('Job description removed successfully!');
}

function loadSavedJobDescription() {
    const savedJobDescription = localStorage.getItem('jobDescription');
    
    if (savedJobDescription) {
        jobDescription = savedJobDescription;
        
        // Update UI
        toggleJdBtn.style.display = 'none';
        jdStatus.style.display = 'flex';
        
        // Create preview
        const preview = jobDescription.length > 50 ? jobDescription.substring(0, 50) + '...' : jobDescription;
        jdPreview.textContent = preview;
        
        // Update welcome message
        updateWelcomeMessage();
    }
}

function updateWelcomeMessage() {
    const welcomeMsg = document.querySelector('.welcome-message .message-content');
    if (welcomeMsg) {
        if (resumeContent && jobDescription) {
            welcomeMsg.innerHTML = `
                <p>🎯 <strong>Targeted Interview Simulation Ready</strong></p>
                <p>I'm role-playing as you for this specific job role!</p>
                <p><small>💡 I'll tailor responses using your resume and the job requirements</small></p>
            `;
        } else if (resumeContent) {
            welcomeMsg.innerHTML = `
                <p>🎉 <strong>Interview Simulation Ready</strong></p>
                <p>I'm role-playing as the candidate from your uploaded resume!</p>
                <p><small>💡 Add a job description for more targeted responses</small></p>
            `;
        } else {
            welcomeMsg.innerHTML = `
                <p>🎉 <strong>Interview Simulation AI Assistant</strong></p>
                <p>Enter your API key above, then upload your resume for interview practice!</p>
                <p><small>💡 Once uploaded, I'll role-play as you during mock interviews</small></p>
            `;
        }
    }
}

function showSuccess(message) {
    // Create a temporary success toast
    const successToast = document.createElement('div');
    successToast.className = 'success-toast';
    successToast.innerHTML = `
        <i class="fas fa-check-circle"></i>
        <span>${message}</span>
    `;
    successToast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--secondary-color);
        color: white;
        padding: 16px 20px;
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        display: flex;
        align-items: center;
        gap: 12px;
        z-index: 1000;
        animation: slideInRight 0.3s ease-out;
    `;
    
    document.body.appendChild(successToast);
    
    setTimeout(() => {
        successToast.remove();
    }, 3000);
}

// Resume upload functionality
async function handleResumeUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (file.type !== 'application/pdf') {
        window.voiceAI.showError('Please upload a PDF file.');
        return;
    }
    
    if (file.size > 10 * 1024 * 1024) { // 10MB limit
        window.voiceAI.showError('File size must be less than 10MB.');
        return;
    }
    
    try {
        pdfLoading.style.display = 'flex';
        
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        
        let fullText = '';
        
        // Extract text from all pages
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        }
        
        if (fullText.trim().length === 0) {
            throw new Error('No text found in the PDF. Please make sure it\'s a text-based PDF.');
        }
        
        // Store resume content
        resumeContent = fullText.trim();
        resumeFileName = file.name;
        
        // Update UI
        uploadResumeBtn.style.display = 'none';
        resumeStatus.style.display = 'flex';
        resumeFilename.textContent = resumeFileName;
        
        // Save to localStorage
        localStorage.setItem('resumeContent', resumeContent);
        localStorage.setItem('resumeFileName', resumeFileName);
        
        // Add confirmation message to chat using class method
        window.voiceAI.addAIMessage(`✅ Resume "${resumeFileName}" uploaded successfully! I'm now ready to role-play as you in mock interviews. Ask me any interview questions and I'll respond as the candidate on your resume.`);
        
        // Update welcome message
        updateWelcomeMessage();
        
        showSuccess('Resume uploaded successfully!');
        
    } catch (error) {
        console.error('Error processing PDF:', error);
        window.voiceAI.showError(`Error processing PDF: ${error.message}`);
    } finally {
        pdfLoading.style.display = 'none';
        // Reset file input
        event.target.value = '';
    }
}

function removeResume() {
    resumeContent = null;
    resumeFileName = null;
    
    // Update UI
    uploadResumeBtn.style.display = 'flex';
    resumeStatus.style.display = 'none';
    
    // Remove from localStorage
    localStorage.removeItem('resumeContent');
    localStorage.removeItem('resumeFileName');
    
    // Add confirmation message to chat using class method
    window.voiceAI.addAIMessage('📄 Resume removed. I\'m now back to general AI assistant mode.');
    
    // Update welcome message
    updateWelcomeMessage();
    
    showSuccess('Resume removed successfully!');
}

function loadSavedResumeData() {
    // Load resume if available
    const savedResumeContent = localStorage.getItem('resumeContent');
    const savedResumeFileName = localStorage.getItem('resumeFileName');
    
    if (savedResumeContent && savedResumeFileName) {
        resumeContent = savedResumeContent;
        resumeFileName = savedResumeFileName;
        
        // Update UI
        uploadResumeBtn.style.display = 'none';
        resumeStatus.style.display = 'flex';
        resumeFilename.textContent = resumeFileName;
        
        // Update welcome message
        updateWelcomeMessage();
    }
} 