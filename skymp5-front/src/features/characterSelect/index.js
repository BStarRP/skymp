import React, { useState, useEffect } from 'react';
import { FrameButton } from '../../components/FrameButton/FrameButton';
import { SkyrimFrame } from '../../components/SkyrimFrame/SkyrimFrame';
import './styles.scss';

const CharacterSelect = ({ send }) => {
  const [characterData, setCharacterData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    console.log('[CharacterSelect] Component mounted, setting up listeners');
    
    const handleCharacterList = (event) => {
      console.log('[CharacterSelect] ✅ Received character list event:', event.detail);
      
      // If detail is null, clear the data (player spawned)
      if (event.detail === null) {
        console.log('[CharacterSelect] Clearing character data (player spawned)');
        setCharacterData(null);
        setError(null);
        return;
      }
      
      setCharacterData(event.detail);
      setError(null);
    };

    const handleCharacterError = (event) => {
      console.log('[CharacterSelect] ❌ Received character error event:', event.detail);
      setError(event.detail.message);
    };

    window.addEventListener('skymp:characterList', handleCharacterList);
    window.addEventListener('skymp:characterError', handleCharacterError);

    // Check if data already exists
    console.log('[CharacterSelect] Checking for existing data in window.skymp:', window.skymp);
    if (window.skymp && window.skymp.characterSelect) {
      console.log('[CharacterSelect] Found existing character data:', window.skymp.characterSelect);
      setCharacterData(window.skymp.characterSelect);
    }
    if (window.skymp && window.skymp.characterSelectError) {
      console.log('[CharacterSelect] Found existing error:', window.skymp.characterSelectError);
      setError(window.skymp.characterSelectError);
    }

    return () => {
      console.log('[CharacterSelect] Component unmounting, removing listeners');
      window.removeEventListener('skymp:characterList', handleCharacterList);
      window.removeEventListener('skymp:characterError', handleCharacterError);
    };
  }, []);

  const handleSelectCharacter = (visibleId) => {
    console.log('[CharacterSelect] 🎮 Selecting character:', visibleId);
    window.skyrimPlatform.sendMessage('characterSelect_select', visibleId);
  };

  const handleCreateCharacter = () => {
    console.log('[CharacterSelect] ➕ Creating new character');
    window.skyrimPlatform.sendMessage('characterSelect_create');
  };

  const handleDeleteCharacter = (visibleId, name) => {
    if (window.confirm(`Are you sure you want to delete character "${name}"?`)) {
      console.log('[CharacterSelect] 🗑️ Deleting character:', visibleId, name);
      window.skyrimPlatform.sendMessage('characterSelect_delete', visibleId);
    }
  };

  const handleBackToLogin = () => {
    console.log('[CharacterSelect] ⬅️ Back to login');
    window.skyrimPlatform.sendMessage('characterSelect_back');
  };

  if (!characterData) {
    console.log('[CharacterSelect] No character data, returning null');
    return null;
  }

  console.log('[CharacterSelect] 📋 Rendering with data:', characterData);

  return (
    <div className="character-select-overlay">
      <div className="character-select-frame-wrapper">
        <SkyrimFrame width={720} height={600} header={true} />
        <div className="character-select-header-title">Character Selection</div>
        <div className="character-select-content">
          {error && (
            <div className="character-select-error">
              {error}
            </div>
          )}

          <p className="character-select-info">
            Using {characterData.currentCount} of {characterData.maxSlots} character slots
          </p>

          <div className="character-select-list">
            {characterData.characters.map((char) => (
              <div key={char.visibleId} className="character-item">
                <div className="character-info">
                  <h3>{char.name}</h3>
                  <p>{char.isFemale ? 'Female' : 'Male'}</p>
                </div>
                <div className="character-actions">
                  <FrameButton
                    text="Select"
                    variant="DEFAULT"
                    width={180}
                    height={48}
                    onClick={() => handleSelectCharacter(char.visibleId)}
                  />
                  <FrameButton
                    text="Delete"
                    variant="DEFAULT"
                    width={180}
                    height={48}
                    onClick={() => handleDeleteCharacter(char.visibleId, char.name)}
                  />
                </div>
              </div>
            ))}
          </div>

          {characterData.currentCount < characterData.maxSlots && (
            <div className="btn-create-wrapper">
              <FrameButton
                text="Create New Character"
                variant="DEFAULT"
                width={384}
                height={56}
                onClick={handleCreateCharacter}
              />
            </div>
          )}

          <div className="btn-back-wrapper">
            <FrameButton
              text="Go Back"
              variant="DEFAULT"
              width={242}
              height={48}
              onClick={handleBackToLogin}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CharacterSelect;
