import Database from '../database/database';
import { User } from '../models/User';

/**
 * Controlador de Autenticación - MVC Pattern
 * Maneja el registro y login de usuarios
 */
class AuthController {
  /**
   * Registra un nuevo usuario
   */
  async register(username, password) {
    try {
      const user = new User({ username, password });
      const validation = user.isValid();
      
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const db = Database.getDatabase();
      
      // Verificar si el usuario ya existe
      const existing = await db.getFirstAsync(
        'SELECT id FROM users WHERE username = ?',
        [username]
      );
      
      if (existing) {
        throw new Error('El nombre de usuario ya está en uso');
      }

      // Insertar nuevo usuario
      const result = await db.runAsync(
        'INSERT INTO users (username, password) VALUES (?, ?)',
        [username, password] // En producción, deberías hashear la contraseña
      );

      // Convertir lastInsertRowId a número
      const userId = typeof result.lastInsertRowId === 'string' 
        ? parseInt(result.lastInsertRowId, 10) 
        : result.lastInsertRowId;

      const newUser = await db.getFirstAsync(
        'SELECT id, username, created_at FROM users WHERE id = ?',
        [userId]
      );

      if (!newUser) {
        throw new Error('Error al crear el usuario');
      }

      // Asegurar que los valores sean del tipo correcto
      const cleanUser = {
        id: newUser.id ? parseInt(newUser.id, 10) : null,
        username: newUser.username || '',
        created_at: newUser.created_at || null,
      };

      return User.fromDatabase(cleanUser);
    } catch (error) {
      console.error('Error al registrar usuario:', error);
      throw error;
    }
  }

  /**
   * Inicia sesión con usuario y contraseña
   */
  async login(username, password) {
    try {
      if (!username || !password) {
        throw new Error('Usuario y contraseña son requeridos');
      }

      const db = Database.getDatabase();
      
      // Buscar usuario
      const user = await db.getFirstAsync(
        'SELECT id, username, password, created_at FROM users WHERE username = ?',
        [username]
      );

      if (!user) {
        throw new Error('Usuario o contraseña incorrectos');
      }

      // Verificar contraseña (en producción, comparar hash)
      if (user.password !== password) {
        throw new Error('Usuario o contraseña incorrectos');
      }

      // Retornar usuario sin password - crear objeto limpio
      const cleanUser = {
        id: user.id ? parseInt(user.id, 10) : null,
        username: user.username || '',
        created_at: user.created_at || null,
      };
      
      return User.fromDatabase(cleanUser);
    } catch (error) {
      console.error('Error al iniciar sesión:', error);
      throw error;
    }
  }

  /**
   * Obtiene un usuario por ID
   */
  async getUserById(id) {
    try {
      const db = Database.getDatabase();
      // Asegurar que id sea un número
      const userId = typeof id === 'string' ? parseInt(id, 10) : id;
      const user = await db.getFirstAsync(
        'SELECT id, username, created_at FROM users WHERE id = ?',
        [userId]
      );

      return user ? User.fromDatabase(user) : null;
    } catch (error) {
      console.error('Error al obtener usuario:', error);
      throw error;
    }
  }
}

export default new AuthController();

