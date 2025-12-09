/**
 * Modelo User - MVC Pattern
 * Representa un usuario del sistema
 */
export class User {
  constructor(data = {}) {
    this.id = data.id || null;
    this.username = data.username || '';
    this.password = data.password || '';
    this.created_at = data.created_at || null;
  }

  /**
   * Valida que el modelo tenga los datos necesarios
   */
  isValid() {
    if (!this.username || this.username.trim() === '') {
      return { valid: false, error: 'El nombre de usuario es requerido' };
    }
    if (this.username.length < 3) {
      return { valid: false, error: 'El nombre de usuario debe tener al menos 3 caracteres' };
    }
    if (!this.password || this.password.trim() === '') {
      return { valid: false, error: 'La contraseña es requerida' };
    }
    if (this.password.length < 4) {
      return { valid: false, error: 'La contraseña debe tener al menos 4 caracteres' };
    }
    return { valid: true };
  }

  /**
   * Convierte el modelo a un objeto plano (sin password)
   */
  toJSON() {
    return {
      id: this.id ? Number(this.id) : null,
      username: String(this.username || ''),
      created_at: this.created_at || null,
    };
  }

  /**
   * Crea una instancia desde un objeto de la base de datos
   */
  static fromDatabase(row) {
    return new User({
      id: row.id ? parseInt(row.id, 10) : null,
      username: row.username || '',
      password: row.password || '', // Solo para comparación, no se expone
      created_at: row.created_at || null,
    });
  }
}

