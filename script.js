// Handle background image loading
document.addEventListener('DOMContentLoaded', function() {
    const bgImage = document.querySelector('.background-image img');
    if (bgImage) {
        bgImage.onerror = function() {
            console.error('Failed to load background image');
            // Try with absolute path
            this.src = window.location.origin + '/cellardog.png';
        };
        bgImage.onload = function() {
            console.log('Background image loaded successfully');
        };
    }
});

// Remove the IE background handler
// function handleIEBackground() {
//     const isIE = /*@cc_on!@*/false || !!document.documentMode;
//     if (isIE) {
//         const fallbackBg = document.getElementById('fallbackBg');
//         if (fallbackBg) {
//             fallbackBg.style.display = 'block';
//             // Add IE-specific filter for opacity
//             fallbackBg.style.filter = 'alpha(opacity=50)';
//             // Add brightness and contrast adjustments
//             fallbackBg.style.filter = 'brightness(70%) contrast(140%)';
//         }
//     }
// }

class BracketManager {
    constructor() {
        this.history = [];
        this.controlMenu = document.getElementById('controlMenu');
        this.isEditingNames = false;
        this.setupFirebase();
        this.setupEventListeners();
        this.setupFullscreenButton();
        this.initializeTextSizing();
    }

    setupFirebase() {
        try {
            console.log('Initializing Firebase...');
            // Initialize Firebase
            firebase.initializeApp(firebaseConfig);
            console.log('Firebase initialized successfully');
            
            // Check if this is the controller
            const urlParams = new URLSearchParams(window.location.search);
            this.isController = urlParams.get('controller') === 'true';
            console.log('Controller mode:', this.isController);
            
            // Initialize database and references
            this.database = firebase.database();
            this.bracketRef = this.database.ref('bracket');
            console.log('Database references created');

            // Set up real-time sync
            this.bracketRef.on('value', (snapshot) => {
                console.log('Received database update:', snapshot.val());
                const state = snapshot.val();
                if (state && !state._status) { // Ignore status updates
                    this.applyState(state);
                }
            }, (error) => {
                console.error('Database error:', error);
            });

            // Monitor connection state
            this.database.ref('.info/connected').on('value', (snap) => {
                if (snap.val() === true) {
                    console.log('Connected to Firebase');
                    
                    // Set up presence system for controller
                    if (this.isController) {
                        const statusRef = this.bracketRef.child('_status');
                        
                        // When we disconnect, remove the status
                        statusRef.onDisconnect().remove();
                        
                        // Set the current status
                        statusRef.set({
                            lastActive: firebase.database.ServerValue.TIMESTAMP,
                            isController: true
                        }).catch(error => {
                            console.error('Error setting status:', error);
                        });
                    }
                } else {
                    console.log('Disconnected from Firebase');
                }
            });

            // Show/hide control menu based on controller status
            if (!this.isController) {
                document.querySelectorAll('.team').forEach(team => {
                    team.style.cursor = 'default';
                    team.style.pointerEvents = 'none';
                });
                document.addEventListener('keydown', (e) => {
                    if (e.code === 'Space') {
                        e.preventDefault();
                    }
                });
                this.controlMenu.style.display = 'none';
            }
        } catch (error) {
            console.error('Firebase setup error:', error);
        }
    }

    initializeTextSizing() {
        // Initial text sizing for all teams
        document.querySelectorAll('.team').forEach(team => {
            this.updateTextSize(team);
        });
    }

    updateTextSize(teamElement) {
        const length = teamElement.textContent.length;
        if (length > 30) {
            teamElement.setAttribute('data-length', 'super-long');
        } else if (length > 25) {
            teamElement.setAttribute('data-length', 'extra-long');
        } else if (length > 20) {
            teamElement.setAttribute('data-length', 'very-long');
        } else if (length > 12) {
            teamElement.setAttribute('data-length', 'long');
        } else {
            teamElement.removeAttribute('data-length');
        }
    }

    setupEventListeners() {
        // Team click events
        document.querySelectorAll('.team').forEach(team => {
            team.addEventListener('click', (e) => {
                if (!this.isEditingNames) {
                    this.handleTeamClick(e);
                }
            });
        });

        // Space bar for control menu
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && e.target === document.body) {
                e.preventDefault();
                this.toggleControlMenu();
            }
        });

        // Control menu buttons
        document.getElementById('randomizeBtn').addEventListener('click', () => this.randomizeEntireBracket());
        document.getElementById('resetBtn').addEventListener('click', () => this.resetBracket());
        document.getElementById('undoBtn').addEventListener('click', () => this.undoLastAction());
        document.getElementById('editNameBtn').addEventListener('click', () => this.editTeamName());
        document.getElementById('closeMenuBtn').addEventListener('click', () => this.toggleControlMenu());
    }

    setupFullscreenButton() {
        const fullscreenBtn = document.getElementById('fullscreenBtn');
        fullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
        });

        // Handle fullscreen change
        document.addEventListener('fullscreenchange', () => {
            const bracketContainer = document.querySelector('.bracket-container');
            if (document.fullscreenElement) {
                bracketContainer.style.transform = 'scale(1)';
            } else {
                bracketContainer.style.transform = '';
            }
        });
    }

    applyState(state) {
        document.querySelectorAll('.match').forEach(match => {
            const matchId = match.dataset.matchId;
            if (state[matchId]) {
                const teams = match.querySelectorAll('.team');
                teams.forEach((team, index) => {
                    const teamState = state[matchId].teams[index];
                    team.textContent = teamState.text || '';
                    team.className = 'team';
                    if (teamState.classes) {
                        teamState.classes.forEach(cls => {
                            if (cls !== 'team') {
                                team.classList.add(cls);
                            }
                        });
                    }
                    if (teamState.teamId) {
                        team.dataset.teamId = teamState.teamId;
                    }
                    this.updateTextSize(team);
                });
            }
        });

        if (state.champion) {
            this.displayChampion(state.champion);
        }
    }

    broadcastState() {
        if (!this.isController) return;

        const state = {};
        document.querySelectorAll('.match').forEach(match => {
            const matchId = match.dataset.matchId;
            const teams = Array.from(match.querySelectorAll('.team')).map(team => {
                // Create a clean team object with no undefined values
                const teamData = {
                    text: team.textContent || '',
                    classes: Array.from(team.classList)
                };
                
                // Only add teamId if it exists
                if (team.dataset.teamId) {
                    teamData.teamId = team.dataset.teamId;
                }
                
                return teamData;
            });

            state[matchId] = {
                teams: teams
            };
        });

        const champion = document.querySelector('.champion');
        if (champion && champion.textContent) {
            state.champion = champion.textContent;
        }

        // Clean up any undefined or null values
        const cleanState = JSON.parse(JSON.stringify(state));

        console.log('Broadcasting state:', cleanState);
        
        this.bracketRef.set(cleanState)
            .then(() => console.log('State broadcast successful'))
            .catch(error => console.error('State broadcast failed:', error));
    }

    handleTeamClick(e) {
        if (!this.isController) return;
        
        const clickedTeam = e.target;
        const match = clickedTeam.closest('.match');
        const otherTeam = Array.from(match.querySelectorAll('.team'))
            .find(team => team !== clickedTeam);

        if (!clickedTeam.textContent) {
            return;
        }

        if (clickedTeam.classList.contains('winner')) {
            return;
        }

        this.saveState();

        clickedTeam.classList.remove('winner', 'loser');
        otherTeam.classList.remove('winner', 'loser');

        clickedTeam.classList.add('winner');
        otherTeam.classList.add('loser');

        const matchId = parseInt(match.dataset.matchId);
        const nextMatchId = this.getNextMatchId(matchId);
        const nextMatch = document.querySelector(`[data-match-id="${nextMatchId}"]`);
        
        if (nextMatch) {
            const isTopTeam = this.isTopTeamInNextMatch(matchId);
            const targetTeam = nextMatch.querySelector(isTopTeam ? '.team1' : '.team2');

            if (targetTeam.classList.contains('loser')) {
                targetTeam.classList.remove('loser');
            }

            targetTeam.textContent = clickedTeam.textContent;
            if (clickedTeam.dataset.teamId) {
                targetTeam.dataset.teamId = clickedTeam.dataset.teamId;
            }
            this.updateTextSize(targetTeam);
            
            nextMatch.querySelectorAll('.team').forEach(team => {
                team.classList.remove('winner', 'loser');
            });
        }

        if (matchId === 16) {
            this.displayChampion(clickedTeam.textContent);
        }

        // Broadcast the updated state
        this.broadcastState();
    }

    getNextMatchId(currentMatchId) {
        // Left side of bracket
        if (currentMatchId >= 1 && currentMatchId <= 8) {
            // First round to second round
            return Math.floor((currentMatchId + 1) / 2) + 8;
        }
        else if (currentMatchId >= 9 && currentMatchId <= 12) {
            // Second round to quarter finals
            return Math.floor((currentMatchId - 8 + 1) / 2) + 12;
        }
        else if (currentMatchId >= 13 && currentMatchId <= 14) {
            // Quarter finals to semi finals
            return 15;
        }
        else if (currentMatchId === 15) {
            // Left semi final to finals
            return 16;
        }
        // Right side of bracket
        else if (currentMatchId >= 24 && currentMatchId <= 31) {
            // First round to second round (right side)
            // Map matches 24-31 to matches 20-23
            const matchPairs = {
                24: 20,
                25: 20,
                26: 21,
                27: 21,
                28: 22,
                29: 22,
                30: 23,
                31: 23
            };
            return matchPairs[currentMatchId];
        }
        else if (currentMatchId >= 20 && currentMatchId <= 23) {
            // Second round to quarter finals (right side)
            // Map matches 20-23 to matches 18-19
            const matchPairs = {
                20: 18,
                21: 18,
                22: 19,
                23: 19
            };
            return matchPairs[currentMatchId];
        }
        else if (currentMatchId >= 18 && currentMatchId <= 19) {
            // Quarter finals to semi finals (right side)
            return 17;
        }
        else if (currentMatchId === 17) {
            // Right semi final to finals
            return 16;
        }
        return null;
    }

    isTopTeamInNextMatch(currentMatchId) {
        // Left side of bracket
        if (currentMatchId <= 15) {
            return currentMatchId % 2 === 1;
        }
        // Right side of bracket
        else if (currentMatchId >= 24 && currentMatchId <= 31) {
            // For matches 24-31 going to 20-23
            const topTeamMatches = [24, 26, 28, 30];
            return topTeamMatches.includes(currentMatchId);
        }
        else if (currentMatchId >= 20 && currentMatchId <= 23) {
            // For matches 20-23 going to 18-19
            return currentMatchId === 20 || currentMatchId === 22;
        }
        else if (currentMatchId >= 18 && currentMatchId <= 19) {
            // For matches 18-19 going to 17
            return currentMatchId === 18;
        }
        // Match 17 going to finals (16)
        return false; // This ensures right side semi-final winner goes to slot 2
    }

    toggleControlMenu() {
        this.controlMenu.classList.toggle('visible');
    }

    randomizeEntireBracket() {
        this.saveState();
        
        // First round matches
        const firstRoundMatches = Array.from(document.querySelectorAll('.round-1 .match, .round-9 .match'));
        
        // Randomize first round
        firstRoundMatches.forEach(match => {
            const teams = match.querySelectorAll('.team');
            const randomTeam = teams[Math.floor(Math.random() * teams.length)];
            randomTeam.click();
        });

        // Continue randomizing until finals
        let pendingMatches;
        do {
            pendingMatches = Array.from(document.querySelectorAll('.match')).filter(match => {
                const teams = match.querySelectorAll('.team');
                return teams[0].textContent && teams[1].textContent && 
                       !teams[0].classList.contains('winner') && 
                       !teams[1].classList.contains('winner');
            });

            if (pendingMatches.length > 0) {
                const randomMatch = pendingMatches[Math.floor(Math.random() * pendingMatches.length)];
                const teams = randomMatch.querySelectorAll('.team');
                const randomTeam = teams[Math.floor(Math.random() * teams.length)];
                randomTeam.click();
            }
        } while (pendingMatches.length > 0);

        this.toggleControlMenu();
    }

    resetBracket() {
        this.saveState();
        
        // Reset all matches
        document.querySelectorAll('.match').forEach(match => {
            const teams = match.querySelectorAll('.team');
            teams.forEach(team => {
                // Clear everything except first round teams
                if (match.closest('.round-1') || match.closest('.round-9')) {
                    team.classList.remove('winner', 'loser');
                } else {
                    team.textContent = '';
                    team.classList.remove('winner', 'loser');
                    team.removeAttribute('data-team-id');
                }
            });
        });

        // Hide champion display
        const championSlot = document.querySelector('.champion-slot');
        const champion = document.querySelector('.champion');
        championSlot.classList.remove('visible');
        champion.classList.remove('visible');
        champion.textContent = '';

        this.toggleControlMenu();
    }

    saveState() {
        const state = {
            matches: Array.from(document.querySelectorAll('.match')).map(match => ({
                id: match.dataset.matchId,
                teams: Array.from(match.querySelectorAll('.team')).map(team => ({
                    text: team.textContent,
                    teamId: team.dataset.teamId,
                    classes: Array.from(team.classList)
                }))
            }))
        };

        // Save champion state if exists
        const champion = document.querySelector('.champion');
        if (champion && champion.textContent) {
            state.champion = champion.textContent;
        }

        this.history.push(state);
    }

    undoLastAction() {
        if (this.history.length === 0) return;

        const previousState = this.history.pop();
        previousState.matches.forEach(matchState => {
            const match = document.querySelector(`[data-match-id="${matchState.id}"]`);
            const teams = match.querySelectorAll('.team');
            
            teams.forEach((team, index) => {
                const teamState = matchState.teams[index];
                team.textContent = teamState.text;
                team.dataset.teamId = teamState.teamId;
                team.className = 'team';
                teamState.classes.forEach(cls => {
                    if (cls !== 'team') {
                        team.classList.add(cls);
                    }
                });
            });
        });

        // Check if there was a champion in the previous state
        if (previousState.champion) {
            this.displayChampion(previousState.champion);
        } else {
            // Hide champion display if there wasn't one
            const championSlot = document.querySelector('.champion-slot');
            const champion = document.querySelector('.champion');
            championSlot.classList.remove('visible');
            champion.classList.remove('visible');
            champion.textContent = '';
        }

        // Broadcast the state change to all viewers
        if (this.isController) {
            this.broadcastState();
        }

        this.toggleControlMenu();
    }

    editTeamName() {
        if (!this.isController) return;
        
        if (!this.isEditingNames) {
            this.isEditingNames = true;
            document.getElementById('editNameBtn').textContent = 'Done Editing';
            
            const firstRoundTeams = document.querySelectorAll('.round-1 .team, .round-9 .team');
            firstRoundTeams.forEach(team => {
                team.contentEditable = true;
                team.classList.add('editing');
                
                team.addEventListener('input', () => {
                    this.updateTextSize(team);
                    this.broadcastState(); // Broadcast updates as names are edited
                });
            });
        } else {
            this.isEditingNames = false;
            document.getElementById('editNameBtn').textContent = 'Edit Team Names';
            
            document.querySelectorAll('.team').forEach(team => {
                team.contentEditable = false;
                team.classList.remove('editing');
            });
            
            // Broadcast final state after editing is done
            this.broadcastState();
        }
    }

    displayChampion(championName) {
        const championSlot = document.querySelector('.champion-slot');
        const champion = document.querySelector('.champion');
        
        championSlot.classList.add('visible');
        champion.textContent = championName;
        
        setTimeout(() => {
            champion.classList.add('visible');
        }, 100);

        // Broadcast champion update
        if (this.isController) {
            this.broadcastState();
        }
    }
}

// Initialize the bracket manager when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new BracketManager();
}); 