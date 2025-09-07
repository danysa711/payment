'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('wa_baileys_config', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      wa_number: {
        type: Sequelize.STRING(20),
        allowNull: false
      },
      session_data: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      is_connected: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      group_id: {
        type: Sequelize.STRING(50),
        allowNull: true
      },
      group_name: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('wa_baileys_config');
  }
};