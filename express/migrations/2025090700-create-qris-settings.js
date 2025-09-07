'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('qris_settings', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      qris_image_path: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      qris_merchant_name: {
        type: Sequelize.STRING(100),
        allowNull: true
      },
      timeout_seconds: {
        type: Sequelize.INTEGER,
        defaultValue: 3600,
        allowNull: false
      },
      max_pending_transactions: {
        type: Sequelize.INTEGER,
        defaultValue: 3,
        allowNull: false
      },
      wa_message_template: {
        type: Sequelize.TEXT,
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
    await queryInterface.dropTable('qris_settings');
  }
};