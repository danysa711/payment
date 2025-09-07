'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('qris_payments', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      payment_ref: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true
      },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id'
        }
      },
      plan_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'SubscriptionPlans',
          key: 'id'
        }
      },
      base_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      unique_digits: {
        type: Sequelize.INTEGER(3),
        allowNull: false
      },
      total_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false
      },
      payment_state: {
        type: Sequelize.ENUM('pending', 'verified', 'rejected', 'expired'),
        defaultValue: 'pending',
        allowNull: false
      },
      payment_method: {
        type: Sequelize.ENUM('qris'),
        defaultValue: 'qris',
        allowNull: false
      },
      verified_at: {
        type: Sequelize.DATE,
        allowNull: true
      },
      verified_by: {
        type: Sequelize.STRING(50),
        allowNull: true
      },
      verification_method: {
        type: Sequelize.ENUM('auto', 'manual', 'whatsapp'),
        allowNull: true
      },
      expired_at: {
        type: Sequelize.DATE,
        allowNull: false
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

    // Tambahkan indeks untuk user_id dan plan_id
    await queryInterface.addIndex('qris_payments', ['user_id']);
    await queryInterface.addIndex('qris_payments', ['plan_id']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('qris_payments');
  }
};