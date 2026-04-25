const express = require('express');
const supabase = require('./supabaseClient');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(cors()); // Enable CORS for all routes
app.use(express.static(__dirname)); // Serve static files from the current directory

// Route to add a new project
app.post('/projects', async (req, res) => {
  const { title, location, client, type, progress, start_date, contract_value, payment_paid, pic, team_members, notes } = req.body;
  try {
    const { data, error } = await supabase
      .from('projects')
      .insert([{ title, location, client, type, progress, start_date, contract_value, payment_paid, pic, team_members, notes }]);
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route to get all projects
app.get('/projects', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('*');
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route to update a project
app.put('/projects/:id', async (req, res) => {
  const { id } = req.params;
  const { title, location, client, type, progress, start_date, contract_value, payment_paid, pic, team_members, notes } = req.body;
  try {
    const { data, error } = await supabase
      .from('projects')
      .update({ title, location, client, type, progress, start_date, contract_value, payment_paid, pic, team_members, notes, modified_at: new Date() })
      .match({ id });
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Route to delete a project
app.delete('/projects/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('projects')
      .delete()
      .match({ id });
    if (error) throw error;
    res.status(204).send(); // No content to send back
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
