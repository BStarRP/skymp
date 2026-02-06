import React from 'react';

import './styles.scss';

const Text = (props) => {
  const text = props.text || '';
  const style = props.style || {};
  return (
        <div className = {'skyrimText'} style={style}>
            <span>
                {text}
            </span>
        </div>
  );
};

export default Text;
